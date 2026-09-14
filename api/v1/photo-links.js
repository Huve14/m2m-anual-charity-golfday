import { z } from "zod";
import { issuePhotoLink } from "../_photos.js";
import {
  parseJsonBody,
  recordAudit,
  requireHostAssignment,
  requireProfile,
  sendError,
  sendJson,
  validate,
  apiFailure,
} from "../_ops.js";
const schema = z.object({
  eventId: z.string().uuid(),
  fourballId: z.string().uuid(),
});
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      throw apiFailure("method_not_allowed", "Method not allowed.", 405);
    }
    const profile = await requireProfile(req);
    const input = validate(schema, parseJsonBody(req));
    if (!["admin", "super_admin"].includes(profile.role))
      await requireHostAssignment(profile.id, input.eventId, input.fourballId);
    const link = await issuePhotoLink({
      ...input,
      kind: "gallery",
      actorId: profile.id,
      label: "Fourball gallery",
    });
    await recordAudit({
      eventId: input.eventId,
      actorId: profile.id,
      action: "photos.link_created",
      entityType: "photo_link",
      entityId: link.id,
    });
    sendJson(res, 200, { ok: true, link });
  } catch (error) {
    sendError(res, error, "The gallery link could not be created.");
  }
}
