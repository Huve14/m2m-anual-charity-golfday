import { z } from "zod";
import {
  adminClient, apiFailure, fromSupabase, parseJsonBody, publicProfile, recordAudit,
  requireAdmin, requireSuperAdmin, sendError, sendJson, validate,
} from "../../_ops.js";

const inviteSchema = z.object({
  action: z.literal("invite").default("invite"),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(2).max(160),
  role: z.enum(["super_admin", "admin", "host"]).default("host"),
  eventId: z.string().uuid().optional(),
  fourballId: z.string().uuid().optional(),
  isPrimary: z.boolean().default(false),
  temporaryPassword: z.string().min(12).max(128)
    .regex(/[a-z]/, "Include a lowercase letter.")
    .regex(/[A-Z]/, "Include an uppercase letter.")
    .regex(/[0-9]/, "Include a number.")
    .regex(/[^A-Za-z0-9]/, "Include a symbol."),
});

const statusSchema = z.object({
  action: z.enum(["deactivate", "reactivate"]),
  profileId: z.string().uuid(),
});

async function list(req, res) {
  const actor = await requireAdmin(req);
  const { data, error } = await adminClient().from("m2m_profiles").select("*").order("full_name");
  if (error) throw fromSupabase(error, "users_load_failed", "Users could not be loaded.");
  sendJson(res, 200, { ok: true, users: data.map(publicProfile), canManageAdmins: actor.role === "super_admin" });
}

async function invite(req, res) {
  const actor = await requireAdmin(req);
  const input = validate(inviteSchema, parseJsonBody(req));
  if (input.role !== "host" && actor.role !== "super_admin") {
    throw apiFailure("permission_denied", "Only a super administrator can invite administrators.", 403);
  }
  if (Boolean(input.eventId) !== Boolean(input.fourballId)) {
    throw apiFailure("assignment_invalid", "Event and fourball assignments must be supplied together.", 400);
  }
  const client = adminClient();
  const { data: existing, error: existingError } = await client.from("m2m_profiles").select("*").eq("email", input.email).maybeSingle();
  if (existingError) throw fromSupabase(existingError, "user_lookup_failed");
  let authUserId = existing?.id || null;
  if (existing) {
    const { error } = await client.auth.admin.updateUserById(existing.id, { password: input.temporaryPassword, email_confirm: true, user_metadata: { full_name: input.fullName } });
    if (error) throw apiFailure("account_password_failed", "The temporary password could not be set.", 503);
  } else {
    const { data, error } = await client.auth.admin.createUser({ email: input.email, password: input.temporaryPassword, email_confirm: true, user_metadata: { full_name: input.fullName } });
    if (error || !data?.user?.id) throw apiFailure("account_create_failed", "The account could not be created.", 503);
    authUserId = data.user.id;
  }

  const effectiveRole = existing && input.role === "host" ? existing.role : input.role;
  const { data: profile, error: profileError } = await client.from("m2m_profiles").upsert({
    id: authUserId, email: input.email, full_name: input.fullName, role: effectiveRole,
    is_active: true, must_change_password: true,
  }, { onConflict: "id" }).select("*").single();
  if (profileError) throw fromSupabase(profileError, "profile_create_failed", "The user profile could not be created.");

  if (input.fourballId) {
    const { error } = await client.rpc("m2m_assign_fourball_host", {
      p_event_id: input.eventId, p_fourball_id: input.fourballId,
      p_profile_id: profile.id, p_is_primary: input.isPrimary,
    });
    if (error) throw fromSupabase(error, "host_assignment_failed", "The host could not be assigned.");
  }

  const delivery = { status: "not_applicable", providerId: null, failureCode: null };

  if (input.eventId) {
    await client.from("m2m_notification_deliveries").insert({
      event_id: input.eventId, fourball_id: input.fourballId, profile_id: profile.id,
      delivery_type: existing ? "magic_link" : "invite", dedupe_key: `invite:${input.eventId}:${input.fourballId}:${profile.id}:${Date.now()}`,
      recipient_email: input.email, status: delivery.status, provider_id: delivery.providerId,
      failure_code: delivery.failureCode, sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
    });
  }
  await recordAudit({ eventId: input.eventId || null, actorId: actor.id, action: "user.invited", entityType: "profile", entityId: profile.id, metadata: { role: effectiveRole, assignedAsHost: input.role === "host", deliveryStatus: delivery.status } });
  sendJson(res, 201, { ok: true, user: publicProfile(profile), delivery: { status: delivery.status } });
}

async function changeStatus(req, res) {
  const input = validate(statusSchema, parseJsonBody(req));
  const actor = await requireAdmin(req);
  const client = adminClient();
  const { data: target, error: targetError } = await client.from("m2m_profiles").select("*").eq("id", input.profileId).single();
  if (targetError) throw fromSupabase(targetError, "user_lookup_failed");
  if (["admin", "super_admin"].includes(target.role)) await requireSuperAdmin(req);
  if (target.id === actor.id && input.action === "deactivate") throw apiFailure("self_deactivation", "You cannot deactivate your own account.", 409);
  const { error } = await client.from("m2m_profiles").update({ is_active: input.action === "reactivate" }).eq("id", target.id);
  if (error) throw fromSupabase(error, "user_status_failed", "The account status could not be changed.");
  await recordAudit({ actorId: actor.id, action: `user.${input.action}`, entityType: "profile", entityId: target.id });
  sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST") return await invite(req, res);
    if (req.method === "PATCH") return await changeStatus(req, res);
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The user request failed.");
  }
}

export const config = { maxDuration: 30 };
