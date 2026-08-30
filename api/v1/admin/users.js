import { z } from "zod";
import {
  adminClient, apiFailure, escapeHtml, fromSupabase, parseJsonBody, publicProfile, recordAudit,
  requestOrigin, requireAdmin, requireSuperAdmin, sendError, sendJson, sendOperationalEmail, validate,
} from "../../_ops.js";

const inviteSchema = z.object({
  action: z.literal("invite").default("invite"),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(2).max(160),
  role: z.enum(["super_admin", "admin", "host"]).default("host"),
  eventId: z.string().uuid().optional(),
  fourballId: z.string().uuid().optional(),
  isPrimary: z.boolean().default(false),
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
  const nextPath = input.eventId ? `/host?event=${encodeURIComponent(input.eventId)}` : "/admin";
  const redirectTo = `${requestOrigin(req)}/auth?next=${encodeURIComponent(nextPath)}`;
  const useCustomEmail = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  let authUserId = existing?.id || null;
  let actionLink = null;
  let delivery = { status: "sent", providerId: null, failureCode: null };

  if (useCustomEmail) {
    const { data, error } = await client.auth.admin.generateLink({
      type: existing ? "magiclink" : "invite",
      email: input.email,
      options: { redirectTo, data: { full_name: input.fullName } },
    });
    if (error || !data?.user?.id || !data?.properties?.action_link) {
      throw apiFailure("invite_link_failed", "A secure invitation link could not be created.", 503);
    }
    authUserId = data.user.id;
    actionLink = data.properties.action_link;
  } else if (existing) {
    const { error } = await client.auth.signInWithOtp({ email: input.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    if (error) throw apiFailure("invite_send_failed", "The sign-in link could not be sent.", 503);
  } else {
    const { data, error } = await client.auth.admin.inviteUserByEmail(input.email, { redirectTo, data: { full_name: input.fullName } });
    if (error || !data?.user?.id) throw apiFailure("invite_send_failed", "The invitation could not be sent.", 503);
    authUserId = data.user.id;
  }

  const effectiveRole = existing && input.role === "host" ? existing.role : input.role;
  const { data: profile, error: profileError } = await client.from("m2m_profiles").upsert({
    id: authUserId, email: input.email, full_name: input.fullName, role: effectiveRole,
    is_active: true,
  }, { onConflict: "id" }).select("*").single();
  if (profileError) throw fromSupabase(profileError, "profile_create_failed", "The user profile could not be created.");

  if (input.fourballId) {
    if (input.isPrimary) await client.from("m2m_fourball_hosts").update({ is_primary: false }).eq("fourball_id", input.fourballId);
    const { error } = await client.from("m2m_fourball_hosts").upsert({
      event_id: input.eventId, fourball_id: input.fourballId, profile_id: profile.id,
      is_primary: input.isPrimary, invited_at: new Date().toISOString(), last_notified_at: new Date().toISOString(),
    }, { onConflict: "fourball_id,profile_id" });
    if (error) throw fromSupabase(error, "host_assignment_failed", "The host could not be assigned.");
  }

  if (actionLink) {
    let eventName = "M2M Golf Day";
    let deadline = null;
    if (input.eventId) {
      const { data } = await client.from("m2m_events").select("name,player_deadline_at").eq("id", input.eventId).maybeSingle();
      if (data) { eventName = data.name; deadline = data.player_deadline_at; }
    }
    delivery = await sendOperationalEmail({
      to: input.email,
      subject: input.role === "host" ? `Your ${eventName} host invitation` : "Your M2M Golf Day administrator invitation",
      html: `<div style="font-family:Arial,sans-serif;color:#17223b;line-height:1.6"><h1 style="color:#c8102e">${escapeHtml(eventName)}</h1><p>Hello ${escapeHtml(input.fullName)},</p><p>You have been invited as ${input.role === "host" ? "a fourball host" : "an administrator"}.${deadline ? ` Player details are due by ${escapeHtml(new Date(deadline).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }))}.` : ""}</p><p><a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:14px 20px;background:#c8102e;color:white;text-decoration:none">Open secure portal</a></p><p>This link is personal and should not be forwarded.</p></div>`,
    });
  }

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
