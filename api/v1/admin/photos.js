import { z } from "zod";
import {
  adminClient,
  apiFailure,
  parseJsonBody,
  recordAudit,
  requireAdmin,
  sendError,
  sendJson,
  validate,
} from "../../_ops.js";
import {
  issuePhotoLink,
  issuePhotoLinkBatch,
  listPhotos,
  photoResult,
  photoSettings,
  signedPhoto,
  tagsSchema,
} from "../../_photos.js";
const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("link-batch"),
    eventId: uuid,
    batchToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    fourballIds: z
      .array(uuid)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.object({
    action: z.literal("moderate"),
    eventId: uuid,
    ids: z
      .array(uuid)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    status: z.enum(["pending", "approved", "rejected"]).nullable(),
    fourballIds: tagsSchema.optional(),
  }),
  z.object({
    action: z.literal("settings"),
    eventId: uuid,
    galleryEnabled: z.boolean(),
    uploadsEnabled: z.boolean(),
  }),
  z.object({
    action: z.literal("link"),
    eventId: uuid,
    kind: z.enum(["staff", "gallery"]),
    fourballId: uuid.nullable().default(null),
    label: z.string().trim().max(120).default(""),
    replaceId: uuid.optional(),
  }),
  z.object({ action: z.literal("revoke"), eventId: uuid, id: uuid }),
]);
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      throw apiFailure("method_not_allowed", "Method not allowed.", 405);
    }
    const profile = await requireAdmin(req);
    const client = adminClient();
    if (req.method === "GET") {
      const input = validate(
        z.object({
          eventId: uuid,
          view: z.enum(["setup", "gallery", "photo"]).default("setup"),
          status: z
            .enum(["pending", "approved", "rejected"])
            .default("pending"),
          before: z.string().max(250).optional(),
          id: uuid.optional(),
        }),
        req.query || {},
      );
      if (input.view === "gallery")
        return sendJson(res, 200, { ok: true, ...(await listPhotos(input)) });
      if (input.view === "photo") {
        if (!input.id)
          throw apiFailure("photo_missing", "Choose a photo.", 400);
        const photo = await photoResult(
          client
            .from("m2m_photos")
            .select("*,tags:m2m_photo_fourballs(fourball_id)")
            .eq("id", input.id)
            .eq("event_id", input.eventId)
            .eq("upload_status", "complete")
            .maybeSingle(),
        );
        if (!photo) throw apiFailure("photo_missing", "Photo not found.", 404);
        return sendJson(res, 200, {
          ok: true,
          photo: await signedPhoto(photo, false),
        });
      }
      const [settings, fourballs, links] = await Promise.all([
        photoSettings(input.eventId),
        photoResult(
          client
            .from("m2m_fourballs")
            .select("id,team_name")
            .eq("event_id", input.eventId)
            .order("team_name"),
        ),
        photoResult(
          client
            .from("m2m_photo_links")
            .select(
              "id,kind,label,fourball_id,created_at,revoked_at,expires_at",
            )
            .eq("event_id", input.eventId)
            .order("created_at", { ascending: false })
            .limit(500),
        ),
      ]);
      return sendJson(res, 200, { ok: true, settings, fourballs, links });
    }
    const input = validate(schema, parseJsonBody(req));
    if (input.action === "link-batch") {
      const links = await issuePhotoLinkBatch({
        ...input,
        actorId: profile.id,
      });
      return sendJson(res, 200, { ok: true, links });
    }
    if (input.action === "moderate")
      await photoResult(
        client.rpc("m2m_photo_moderate", {
          p_event: input.eventId,
          p_ids: input.ids,
          p_actor: profile.id,
          p_status: input.status,
          p_fourballs: input.fourballIds ?? null,
        }),
      );
    if (input.action === "settings")
      await photoResult(
        client.from("m2m_photo_settings").upsert({
          event_id: input.eventId,
          gallery_enabled: input.galleryEnabled,
          uploads_enabled: input.uploadsEnabled,
        }),
      );
    if (input.action === "link") {
      if ((input.kind === "gallery") !== Boolean(input.fourballId))
        throw apiFailure(
          "link_invalid",
          "Choose a fourball for gallery access.",
          400,
        );
      const link = await issuePhotoLink({ ...input, actorId: profile.id });
      await recordAudit({
        eventId: input.eventId,
        actorId: profile.id,
        action: "photos.link_created",
        entityType: "photo_link",
        entityId: link.id,
      });
      return sendJson(res, 200, { ok: true, link });
    }
    if (input.action === "revoke")
      await photoResult(
        client
          .from("m2m_photo_links")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", input.id)
          .eq("event_id", input.eventId),
      );
    if (input.action !== "moderate")
      await recordAudit({
        eventId: input.eventId,
        actorId: profile.id,
        action: `photos.${input.action}`,
        entityType: "event",
        entityId: input.eventId,
      });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error, "The photo administration request failed.");
  }
}
