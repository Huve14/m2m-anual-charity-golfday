import { z } from "zod";
import { adminClient, fromSupabase, parseJsonBody, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const schema = z.object({
  eventId: z.string().uuid(),
  kind: z.enum(["logo", "banner"]),
  extension: z.enum(["png", "jpg", "jpeg", "webp"]),
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    await requireAdmin(req);
    const input = validate(schema, parseJsonBody(req));
    const path = `${input.eventId}/${input.kind}-${Date.now()}.${input.extension}`;
    const client = adminClient();
    const { data, error } = await client.storage.from("m2m-event-branding").createSignedUploadUrl(path);
    if (error) throw fromSupabase(error, "branding_upload_failed", "An upload URL could not be created.");
    const { data: publicUrl } = client.storage.from("m2m-event-branding").getPublicUrl(path);
    sendJson(res, 200, { ok: true, path, token: data.token, signedUrl: data.signedUrl, publicUrl: publicUrl.publicUrl });
  } catch (error) {
    sendError(res, error, "The branding upload could not be prepared.");
  }
}

