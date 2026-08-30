import { z } from "zod";
import { adminClient, apiFailure, parseJsonBody, publicProfile, recordAudit, requireProfile, sendError, sendJson, validate } from "../_ops.js";

const schema = z.object({
  password: z.string().min(12).max(128)
    .regex(/[a-z]/, "Include a lowercase letter.")
    .regex(/[A-Z]/, "Include an uppercase letter.")
    .regex(/[0-9]/, "Include a number.")
    .regex(/[^A-Za-z0-9]/, "Include a symbol."),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation, { message: "Passwords do not match.", path: ["confirmation"] });

export default async function handler(req, res) {
  try {
    const profile = await requireProfile(req, [], { allowPasswordChange: true });
    if (req.method === "GET") return sendJson(res, 200, { ok: true, profile: publicProfile(profile) });
    if (req.method !== "PATCH") { res.setHeader("Allow", "GET, PATCH"); return sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." }); }
    const input = validate(schema, parseJsonBody(req));
    const client = adminClient();
    const { error: authError } = await client.auth.admin.updateUserById(profile.id, { password: input.password });
    if (authError) throw apiFailure("password_update_failed", "Your password could not be changed.", 503);
    const { error } = await client.from("m2m_profiles").update({ must_change_password: false }).eq("id", profile.id);
    if (error) throw apiFailure("profile_update_failed", "Your account could not be unlocked.", 503);
    await recordAudit({ actorId: profile.id, action: "password.initial_changed", entityType: "profile", entityId: profile.id });
    sendJson(res, 200, { ok: true });
  } catch (error) { sendError(res, error, "The password could not be changed."); }
}
