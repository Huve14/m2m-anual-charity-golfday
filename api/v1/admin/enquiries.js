import { z } from "zod";
import { adminClient, apiFailure, escapeHtml, fromSupabase, parseJsonBody, requestOrigin, requireAdmin, sendError, sendJson, sendOperationalEmail, validate } from "../../_ops.js";

const conversionSchema = z.object({
  registrationId: z.string().trim().min(6).max(80),
  eventId: z.string().uuid(),
  companyId: z.string().uuid().nullable().optional(),
  companyName: z.string().trim().min(2).max(180),
  sponsorshipTypeId: z.string().uuid().nullable().optional(),
});

async function list(req, res) {
  await requireAdmin(req);
  const client = adminClient();
  const [enquiries, conversions] = await Promise.all([
    client.from(process.env.SUPABASE_REGISTRATION_TABLE || "m2m_registrations").select("registration_id,submitted_at,status,email,contact_name,company,phone,fourball_count,players,sponsorship_option,sponsorship_label,sponsorship_amount,total_amount,notes").order("submitted_at", { ascending: false }).limit(1000),
    client.from("m2m_legacy_enquiry_conversions").select("registration_id,event_id,converted_at"),
  ]);
  if (enquiries.error || conversions.error) throw fromSupabase(enquiries.error || conversions.error, "enquiries_load_failed", "Website enquiries could not be loaded.");
  const converted = new Map(conversions.data.map((item) => [item.registration_id, item]));
  sendJson(res, 200, { ok: true, enquiries: enquiries.data.map((item) => ({
    registrationId: item.registration_id, submittedAt: item.submitted_at, status: item.status,
    email: item.email, contactName: item.contact_name, company: item.company || "", phone: item.phone || "",
    fourballCount: item.fourball_count, players: item.players || [], sponsorshipOption: item.sponsorship_option || "",
    sponsorshipLabel: item.sponsorship_label || "", sponsorshipAmount: item.sponsorship_amount || 0,
    totalAmount: item.total_amount || 0, notes: item.notes || "", conversion: converted.get(item.registration_id) || null,
  })) });
}

async function convert(req, res) {
  const actor = await requireAdmin(req);
  const input = validate(conversionSchema, parseJsonBody(req));
  const client = adminClient();
  const { data: enquiry, error: enquiryError } = await client.from(process.env.SUPABASE_REGISTRATION_TABLE || "m2m_registrations").select("email,contact_name").eq("registration_id", input.registrationId).maybeSingle();
  if (enquiryError) throw fromSupabase(enquiryError, "enquiry_load_failed");
  if (!enquiry) throw apiFailure("enquiry_not_found", "This website enquiry no longer exists.", 404);

  const normalEmail = String(enquiry.email || "").trim().toLowerCase();
  let { data: hostProfile, error: profileError } = await client.from("m2m_profiles").select("*").eq("email", normalEmail).maybeSingle();
  if (profileError) throw fromSupabase(profileError, "host_lookup_failed");
  const redirectTo = `${requestOrigin(req)}/auth?next=${encodeURIComponent(`/host?event=${input.eventId}`)}`;
  let createdAuthUser = false;
  let actionLink = null;
  if (!hostProfile && normalEmail) {
    const { data: invite, error: inviteError } = await client.auth.admin.generateLink({ type: "invite", email: normalEmail, options: { redirectTo, data: { full_name: enquiry.contact_name || normalEmail } } });
    if (inviteError || !invite?.user?.id || !invite.properties?.action_link) throw apiFailure("host_invite_failed", "The registrant could not be prepared as a host.", 503);
    createdAuthUser = true;
    actionLink = invite.properties.action_link;
    const { data, error } = await client.from("m2m_profiles").insert({ id: invite.user.id, email: normalEmail, full_name: enquiry.contact_name || normalEmail, role: "host", is_active: true }).select("*").single();
    if (error) {
      await client.auth.admin.deleteUser(invite.user.id);
      throw fromSupabase(error, "host_profile_failed");
    }
    hostProfile = data;
  } else if (hostProfile) {
    const { data: link, error: linkError } = await client.auth.admin.generateLink({ type: "magiclink", email: normalEmail, options: { redirectTo } });
    if (linkError || !link?.properties?.action_link) throw apiFailure("host_invite_failed", "A secure host link could not be prepared.", 503);
    actionLink = link.properties.action_link;
  }

  const { data, error } = await client.rpc("m2m_convert_legacy_enquiry", {
    p_registration_id: input.registrationId,
    p_event_id: input.eventId,
    p_company_id: input.companyId || null,
    p_company_name: input.companyName,
    p_sponsorship_type_id: input.sponsorshipTypeId || null,
    p_host_profile_id: hostProfile?.id || null,
    p_actor_id: actor.id,
  });
  if (error) {
    if (createdAuthUser && hostProfile?.id) await client.auth.admin.deleteUser(hostProfile.id);
    if (String(error.message || "").includes("m2m_enquiry_already_converted")) throw apiFailure("enquiry_already_converted", "This enquiry has already been converted.", 409);
    throw fromSupabase(error, "enquiry_conversion_failed", "The enquiry could not be converted.");
  }
  let delivery = { status: "skipped", providerId: null, failureCode: "email_unavailable" };
  if (actionLink && normalEmail) {
    const { data: event } = await client.from("m2m_events").select("name,player_deadline_at").eq("id", input.eventId).maybeSingle();
    delivery = await sendOperationalEmail({
      to: normalEmail,
      subject: `Your ${event?.name || "M2M Golf Day"} host invitation`,
      html: `<div style="font-family:Arial,sans-serif;color:#17223b;line-height:1.6"><h1 style="color:#c8102e">${escapeHtml(event?.name || "M2M Golf Day")}</h1><p>Hello ${escapeHtml(enquiry.contact_name || normalEmail)},</p><p>Your website enquiry has been added to the golf-day workspace. Complete the player details for your assigned fourball${data.fourballIds?.length === 1 ? "" : "s"}${event?.player_deadline_at ? ` by ${escapeHtml(new Date(event.player_deadline_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }))}` : ""}.</p><p><a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:14px 20px;background:#c8102e;color:white;text-decoration:none">Open secure host portal</a></p><p>This personal link should not be forwarded.</p></div>`,
    });
  }
  const notifiedAt = delivery.status === "sent" ? new Date().toISOString() : null;
  if (hostProfile?.id && data.fourballIds?.length) {
    if (notifiedAt) await client.from("m2m_fourball_hosts").update({ invited_at: notifiedAt, last_notified_at: notifiedAt }).eq("event_id", input.eventId).eq("profile_id", hostProfile.id).in("fourball_id", data.fourballIds);
    await client.from("m2m_notification_deliveries").insert(data.fourballIds.map((fourballId) => ({
      event_id: input.eventId, fourball_id: fourballId, profile_id: hostProfile.id,
      delivery_type: createdAuthUser ? "invite" : "magic_link", dedupe_key: `legacy-invite:${input.registrationId}:${fourballId}`,
      recipient_email: normalEmail, status: delivery.status, provider_id: delivery.providerId,
      failure_code: delivery.failureCode, sent_at: notifiedAt,
    })));
  }
  sendJson(res, 201, { ok: true, conversion: data, delivery: { status: delivery.status } });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST") return await convert(req, res);
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The website-enquiry request failed.");
  }
}

export const config = { maxDuration: 30 };
