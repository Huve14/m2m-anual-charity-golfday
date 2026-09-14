import { z } from "zod";
import {
  adminClient,
  apiFailure,
  parseJsonBody,
  sendError,
  sendJson,
  validate,
} from "../_ops.js";
import {
  canReadPhoto,
  completePhoto,
  fileSchema,
  listPhotos,
  photoAccess,
  photoResult,
  signedPhoto,
  tagsSchema,
  uploadCredentials,
} from "../_photos.js";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reserve"),
    batchId: z.string().uuid(),
    files: z
      .array(fileSchema)
      .min(1)
      .max(100)
      .refine((files) => new Set(files.map((f) => f.id)).size === files.length),
    fourballIds: tagsSchema,
  }),
  z.object({
    action: z.literal("retag"),
    id: z.string().uuid(),
    fourballIds: tagsSchema,
  }),
  z.object({ action: z.literal("credentials"), id: z.string().uuid() }),
  z.object({ action: z.literal("complete"), id: z.string().uuid() }),
]);
const querySchema = z.object({
  view: z.enum(["context", "gallery", "photo"]).default("context"),
  scope: z.enum(["mine", "all"]).default("all"),
  id: z.string().uuid().optional(),
  before: z.string().max(250).optional(),
});
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      throw apiFailure("method_not_allowed", "Method not allowed.", 405);
    }
    const { link, settings } = await photoAccess(req, {
      upload: req.method === "POST",
    });
    const client = adminClient();
    if (req.method === "GET") {
      const input = validate(querySchema, req.query || {});
      if (input.view === "context") {
        const event = await photoResult(
          client
            .from("m2m_events")
            .select("id,name")
            .eq("id", link.event_id)
            .single(),
        );
        let teams = client
          .from("m2m_fourballs")
          .select("id,team_name")
          .eq("event_id", link.event_id)
          .order("team_name");
        if (link.kind === "gallery") teams = teams.eq("id", link.fourball_id);
        return sendJson(res, 200, {
          ok: true,
          event,
          kind: link.kind,
          fourballId: link.fourball_id,
          fourballs: await photoResult(teams),
          uploadsEnabled: settings.uploads_enabled,
        });
      }
      if (link.kind !== "gallery")
        throw apiFailure(
          "permission_denied",
          "This link allows photo contributions only.",
          403,
        );
      if (input.view === "photo") {
        if (!input.id)
          throw apiFailure("photo_missing", "Choose a photo.", 400);
        const photo = await photoResult(
          client
            .from("m2m_photos")
            .select("*,tags:m2m_photo_fourballs(fourball_id)")
            .eq("id", input.id)
            .eq("event_id", link.event_id)
            .maybeSingle(),
        );
        if (!photo || !canReadPhoto(link, photo))
          throw apiFailure(
            "photo_missing",
            "This photo is no longer available.",
            404,
          );
        return sendJson(res, 200, {
          ok: true,
          photo: await signedPhoto(photo, false),
        });
      }
      return sendJson(res, 200, {
        ok: true,
        ...(await listPhotos({
          eventId: link.event_id,
          fourballId: input.scope === "mine" ? link.fourball_id : undefined,
          before: input.before,
        })),
      });
    }
    const input = validate(bodySchema, parseJsonBody(req));
    if (input.action === "reserve") {
      const photos = await photoResult(
        client.rpc("m2m_photo_reserve", {
          p_link: link.id,
          p_batch: input.batchId,
          p_files: input.files,
          p_fourballs: input.fourballIds,
        }),
      );
      return sendJson(res, 200, {
        ok: true,
        photos: photos.map((p) => ({
          id: p.id,
          complete: p.upload_status === "complete",
        })),
      });
    }
    if (input.action === "retag") {
      await photoResult(
        client.rpc("m2m_photo_retag", {
          p_link: link.id,
          p_photo: input.id,
          p_fourballs: input.fourballIds,
        }),
      );
      return sendJson(res, 200, { ok: true });
    }
    if (input.action === "credentials") {
      const photo = await photoResult(
        client
          .from("m2m_photos")
          .select("*")
          .eq("id", input.id)
          .eq("link_id", link.id)
          .eq("event_id", link.event_id)
          .maybeSingle(),
      );
      if (!photo)
        throw apiFailure("photo_missing", "This upload was not found.", 404);
      if (photo.upload_status === "complete")
        return sendJson(res, 200, { ok: true, id: photo.id, complete: true });
      return sendJson(res, 200, {
        ok: true,
        ...(await uploadCredentials(photo)),
      });
    }
    return sendJson(res, 200, {
      ok: true,
      ...(await completePhoto(link, input.id)),
    });
  } catch (error) {
    sendError(res, error, "The photo request failed.");
  }
}
