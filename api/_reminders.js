import { adminClient, apiFailure, escapeHtml, fromSupabase, requestOrigin, sendOperationalEmail } from "./_ops.js";

export async function sendHostReminder({ req, eventId, fourballId, profileId, offsetLabel = "manual", scheduledFor = null }) {
  const client = adminClient();
  const [eventResult, fourballResult, profileResult] = await Promise.all([
    client.from("m2m_events").select("id,name,player_deadline_at").eq("id", eventId).single(),
    client.from("m2m_fourballs").select("id,team_name,submission_status").eq("id", fourballId).eq("event_id", eventId).single(),
    client.from("m2m_profiles").select("id,email,full_name,is_active").eq("id", profileId).single(),
  ]);
  if (eventResult.error || fourballResult.error || profileResult.error) throw fromSupabase(eventResult.error || fourballResult.error || profileResult.error, "reminder_target_failed");
  const event = eventResult.data;
  const fourball = fourballResult.data;
  const profile = profileResult.data;
  if (!profile.is_active || fourball.submission_status === "submitted") return { status: "skipped" };
  const dedupeKey = `reminder:${eventId}:${fourballId}:${profileId}:${offsetLabel}:${scheduledFor || new Date().toISOString().slice(0, 10)}`;
  const { data: existing } = await client.from("m2m_notification_deliveries").select("id,status").eq("dedupe_key", dedupeKey).maybeSingle();
  if (existing) return { status: "skipped", duplicate: true };

  const useCustomEmail = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  let delivery;
  if (useCustomEmail) {
    const redirectTo = `${requestOrigin(req)}/auth?next=${encodeURIComponent(`/host?event=${eventId}`)}`;
    const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email: profile.email, options: { redirectTo } });
    if (error || !data?.properties?.action_link) throw apiFailure("reminder_link_failed", "A secure reminder link could not be created.", 503);
    const deadline = event.player_deadline_at ? new Date(event.player_deadline_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "long", timeStyle: "short" }) : "the event deadline";
    delivery = await sendOperationalEmail({
      to: profile.email,
      subject: `${event.name}: player details outstanding`,
      html: `<div style="font-family:Arial,sans-serif;color:#17223b;line-height:1.6"><h1 style="color:#c8102e">Player details reminder</h1><p>Hello ${escapeHtml(profile.full_name)},</p><p>The player list for <strong>${escapeHtml(fourball.team_name)}</strong> at ${escapeHtml(event.name)} is still outstanding. Please complete it before ${escapeHtml(deadline)}.</p><p><a href="${escapeHtml(data.properties.action_link)}" style="display:inline-block;padding:14px 20px;background:#c8102e;color:white;text-decoration:none">Complete player details</a></p></div>`,
    });
  } else {
    const { error } = await client.auth.signInWithOtp({ email: profile.email, options: { shouldCreateUser: false, emailRedirectTo: `${requestOrigin(req)}/host?event=${eventId}` } });
    delivery = error ? { status: "failed", failureCode: "supabase_email_failed", providerId: null } : { status: "sent", failureCode: null, providerId: null };
  }
  const { error: deliveryError } = await client.from("m2m_notification_deliveries").insert({
    event_id: eventId, fourball_id: fourballId, profile_id: profileId, delivery_type: "reminder",
    dedupe_key: dedupeKey, recipient_email: profile.email, status: delivery.status,
    provider_id: delivery.providerId || null, failure_code: delivery.failureCode || null,
    scheduled_for: scheduledFor, sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
  });
  if (deliveryError) throw fromSupabase(deliveryError, "reminder_record_failed");
  await client.from("m2m_fourball_hosts").update({ last_notified_at: new Date().toISOString() }).eq("event_id", eventId).eq("fourball_id", fourballId).eq("profile_id", profileId);
  return { status: delivery.status };
}

