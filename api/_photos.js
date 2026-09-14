import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  adminClient,
  apiFailure,
  fromSupabase,
  opsConfig,
  validate,
} from "./_ops.js";

export const PHOTO_BUCKET = "m2m-photos";
export const STAGING_BUCKET = "m2m-photo-staging";
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const fileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(180),
  type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(MAX_PHOTO_BYTES),
});
export const tagsSchema = z
  .array(z.string().uuid())
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
export function hashPhotoToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
export function photoError(error) {
  const errors = {
    photo_batch_rate_limit: [
      429,
      "Too many new QR batches. Please wait a minute before starting another batch.",
    ],
    photo_link_limit: [
      429,
      "This fourball or event has reached its active-link allowance. Revoke an old link first.",
    ],
    photo_link_invalid: [
      403,
      "This photo link has expired or been revoked. Ask the organiser for a new link.",
    ],
    photo_rate_limit: [
      429,
      "Too many requests. Please wait a minute and retry.",
    ],
    photo_quota_exceeded: [
      429,
      "The photo upload allowance has been reached. Contact the organiser.",
    ],
    photo_uploads_closed: [403, "Photo uploads are currently closed."],
    photo_not_ready: [409, "Only completed uploads can be reviewed."],
    photo_tags_invalid: [400, "Choose fourballs belonging to this event."],
    photo_batch_invalid: [400, "This upload batch is invalid."],
  };
  for (const [code, [status, message]] of Object.entries(errors))
    if (String(error?.message).includes(code))
      return apiFailure(code, message, status);
  return fromSupabase(
    error,
    "photos_failed",
    "The photo request could not be completed.",
  );
}
export async function photoResult(query) {
  const { data, error } = await query;
  if (error) throw photoError(error);
  return data;
}
export async function photoSettings(eventId) {
  return (
    (await photoResult(
      adminClient()
        .from("m2m_photo_settings")
        .select("*")
        .eq("event_id", eventId)
        .maybeSingle(),
    )) || {
      event_id: eventId,
      gallery_enabled: true,
      uploads_enabled: true,
      photo_limit: 10000,
      byte_limit: 268435456000,
    }
  );
}
export async function photoAccess(req, { upload = false } = {}) {
  const token = String(req.headers?.["x-photo-token"] || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw photoError({ message: "photo_link_invalid" });
  const link = await photoResult(
    adminClient()
      .rpc("m2m_photo_access", { p_hash: hashPhotoToken(token) })
      .single(),
  );
  const settings = await photoSettings(link.event_id);
  if (!settings.gallery_enabled)
    throw apiFailure(
      "gallery_closed",
      "The organiser has closed photo access.",
      403,
    );
  if (upload && !settings.uploads_enabled)
    throw photoError({ message: "photo_uploads_closed" });
  return { link, settings };
}
export async function issuePhotoLink({
  eventId,
  fourballId = null,
  kind,
  label = "",
  actorId,
  replaceId = null,
}) {
  const client = adminClient();
  if (fourballId) {
    const team = await photoResult(
      client
        .from("m2m_fourballs")
        .select("id")
        .eq("event_id", eventId)
        .eq("id", fourballId)
        .maybeSingle(),
    );
    if (!team) throw photoError({ message: "photo_tags_invalid" });
  }
  const token = randomBytes(32).toString("base64url");
  const record = await photoResult(
    client
      .rpc("m2m_photo_issue_link", {
        p_event: eventId,
        p_fourball: fourballId,
        p_kind: kind,
        p_label: label,
        p_hash: hashPhotoToken(token),
        p_actor: actorId,
        p_replace: replaceId,
      })
      .single(),
  );
  const link = {
    id: record.id,
    kind: record.kind,
    label: record.label,
    fourball_id: record.fourball_id,
  };
  return { ...link, path: `/photos#${token}` };
}
// The random, browser-held batch secret permits safe replay after a lost response.
// Only its hash and derived token hashes are stored in the database.
export async function issuePhotoLinkBatch({
  eventId,
  actorId,
  batchToken,
  fourballIds,
}) {
  const tokens = new Map(
    [...fourballIds].sort().map((id) => [
      id,
      createHmac("sha256", batchToken)
        .update(JSON.stringify(["photo-cart", eventId, actorId, id]))
        .digest("base64url"),
    ]),
  );
  const records = await photoResult(
    adminClient().rpc("m2m_photo_issue_link_batch", {
      p_id: hashPhotoToken(batchToken),
      p_event: eventId,
      p_actor: actorId,
      p_links: [...tokens].map(([fourball_id, token]) => ({
        fourball_id,
        token_hash: hashPhotoToken(token),
      })),
    }),
  );
  return records.map((record) => ({
    id: record.id,
    kind: record.kind,
    label: record.label,
    fourball_id: record.fourball_id,
    path: `/photos#${tokens.get(record.fourball_id)}`,
  }));
}
export function canReadPhoto(link, photo) {
  return (
    link.kind === "gallery" &&
    photo.event_id === link.event_id &&
    photo.upload_status === "complete" &&
    photo.status === "approved"
  );
}
export async function signedPhoto(photo, previewOnly = true) {
  const client = adminClient();
  const preview = await photoResult(
    client.storage.from(PHOTO_BUCKET).createSignedUrl(photo.preview_path, 60),
  );
  const result = {
    id: photo.id,
    filename: photo.filename,
    createdAt: photo.created_at,
    status: photo.status,
    source: photo.source,
    batchId: photo.batch_id,
    fourballIds: (photo.tags || []).map((t) => t.fourball_id),
    previewUrl: preview.signedUrl,
  };
  if (!previewOnly) {
    const full = await photoResult(
      client.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(photo.original_path, 60, {
          download: `golf-day-${photo.id}.jpg`,
        }),
    );
    result.downloadUrl = full.signedUrl;
  }
  return result;
}
export async function listPhotos({
  eventId,
  status = "approved",
  fourballId,
  before,
  after,
  limit = 36,
}) {
  let query = adminClient()
    .from("m2m_photos")
    .select(
      `*,tags:m2m_photo_fourballs${fourballId ? "!inner" : ""}(fourball_id)`,
    )
    .eq("event_id", eventId)
    .eq("upload_status", "complete")
    .eq("status", status);
  if (fourballId) query = query.eq("tags.fourball_id", fourballId);
  // Cursor contains a validated timestamp and UUID; never interpolate arbitrary PostgREST syntax.
  if (before || after) {
    let decoded;
    try {
      decoded = JSON.parse(
        Buffer.from(before || after, "base64url").toString(),
      );
    } catch {
      throw apiFailure(
        "cursor_invalid",
        "This gallery page is invalid. Reload the gallery.",
        400,
      );
    }
    const cursor = validate(
      z.object({
        at: z.string().datetime({ offset: true }),
        id: z.string().uuid(),
      }),
      decoded,
    );
    const op = before ? "lt" : "gt";
    query = query.or(
      `created_at.${op}.${cursor.at},and(created_at.eq.${cursor.at},id.${op}.${cursor.id})`,
    );
  }
  const rows = await photoResult(
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
  );
  const page = rows.slice(0, limit);
  const cursor = (row) =>
    row
      ? Buffer.from(
          JSON.stringify({ at: row.created_at, id: row.id }),
        ).toString("base64url")
      : null;
  const signed = page.length
    ? await photoResult(
        adminClient()
          .storage.from(PHOTO_BUCKET)
          .createSignedUrls(
            page.map((row) => row.preview_path),
            60,
          ),
      )
    : [];
  const photos = page.map((photo, index) => ({
    id: photo.id,
    filename: photo.filename,
    createdAt: photo.created_at,
    status: photo.status,
    source: photo.source,
    batchId: photo.batch_id,
    fourballIds: (photo.tags || []).map((t) => t.fourball_id),
    previewUrl: signed[index]?.signedUrl || "",
  }));
  return {
    photos,
    next: rows.length > limit ? cursor(page.at(-1)) : null,
    newest: cursor(page[0]),
  };
}
export async function uploadCredentials(photo) {
  const data = await photoResult(
    adminClient()
      .storage.from(STAGING_BUCKET)
      .createSignedUploadUrl(photo.staging_path),
  );
  const config = opsConfig();
  const base = new URL(config.url);
  if (base.hostname.endsWith(".supabase.co"))
    base.hostname = base.hostname.replace(
      ".supabase.co",
      ".storage.supabase.co",
    );
  return {
    id: photo.id,
    path: photo.staging_path,
    token: data.token,
    endpoint: `${base.origin}/storage/v1/upload/resumable/sign`,
    publishableKey: config.publishableKey,
    complete: photo.upload_status === "complete",
  };
}
export async function normalisePhoto(bytes, expectedType) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    throw apiFailure(
      "photo_size_invalid",
      "Photos must be no larger than 25 MB.",
      400,
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: 60000000,
      failOn: "warning",
    });
    const meta = await image.metadata();
    const types = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    if (types[meta.format] !== expectedType || (meta.pages || 1) > 1)
      throw new Error("format");
    // Decode and re-encode, stripping GPS/EXIF and validating the entire raster before approval.
    const original = await image
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 95 })
      .toBuffer();
    const preview = await sharp(original)
      .resize({
        width: 720,
        height: 720,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();
    return { original, preview };
  } catch {
    throw apiFailure(
      "photo_format_invalid",
      "Use a valid, non-animated JPEG, PNG or WebP photo (up to 60 megapixels). Export other formats to JPEG.",
      400,
    );
  }
}
export async function completePhoto(link, id) {
  const client = adminClient();
  const photo = await photoResult(
    client
      .from("m2m_photos")
      .select("*")
      .eq("id", id)
      .eq("event_id", link.event_id)
      .eq("link_id", link.id)
      .maybeSingle(),
  );
  if (!photo)
    throw apiFailure("photo_missing", "This upload was not found.", 404);
  if (photo.upload_status === "complete") return { id, complete: true };
  const blob = await photoResult(
    client.storage.from(STAGING_BUCKET).download(photo.staging_path),
  );
  if (blob.size !== photo.byte_size)
    throw apiFailure(
      "photo_size_invalid",
      "The uploaded photo size does not match. Retry the upload.",
      400,
    );
  const { original, preview } = await normalisePhoto(
    Buffer.from(await blob.arrayBuffer()),
    photo.content_type,
  );
  // Unique final paths keep concurrent finalisations and issued staging credentials from overwriting reviewed bytes.
  const prefix = `${link.event_id}/${id}/${randomUUID()}`;
  const paths = [`${prefix}.jpg`, `${prefix}.webp`];
  try {
    await photoResult(
      client.storage.from(PHOTO_BUCKET).upload(paths[0], original, {
        contentType: "image/jpeg",
        cacheControl: "0",
      }),
    );
    await photoResult(
      client.storage.from(PHOTO_BUCKET).upload(paths[1], preview, {
        contentType: "image/webp",
        cacheControl: "0",
      }),
    );
    // Recheck revocation and closure after the potentially long image work.
    const current = await photoResult(
      client
        .from("m2m_photo_links")
        .select("revoked_at,expires_at")
        .eq("id", link.id)
        .single(),
    );
    if (
      current.revoked_at ||
      (current.expires_at && Date.parse(current.expires_at) <= Date.now())
    )
      throw photoError({ message: "photo_link_invalid" });
    const settings = await photoSettings(link.event_id);
    if (!settings.uploads_enabled || !settings.gallery_enabled)
      throw photoError({ message: "photo_uploads_closed" });
    const saved = await photoResult(
      client
        .from("m2m_photos")
        .update({
          upload_status: "complete",
          original_path: paths[0],
          preview_path: paths[1],
          completed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("upload_status", "uploading")
        .select("id"),
    );
    if (!saved.length) await client.storage.from(PHOTO_BUCKET).remove(paths);
  } catch (error) {
    await client.storage.from(PHOTO_BUCKET).remove(paths);
    throw error;
  }
  await client.storage.from(STAGING_BUCKET).remove([photo.staging_path]);
  return { id, complete: true };
}
