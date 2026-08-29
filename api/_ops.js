import { createClient } from "@supabase/supabase-js";

let cachedAdminClient;
let cachedAuthClient;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function opsConfig() {
  const url = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
  const secret = clean(
    process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.service_role,
  );
  const publishableKey = clean(
    process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY,
  );
  return { url, secret, publishableKey, configured: Boolean(url && secret) };
}

export function adminClient() {
  const config = opsConfig();
  if (!config.configured) throw apiFailure("service_unavailable", "Golf-day storage is unavailable.", 503);
  if (!cachedAdminClient) {
    cachedAdminClient = createClient(config.url, config.secret, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "m2m-golf-operations/1.0" } },
    });
  }
  return cachedAdminClient;
}

function authClient() {
  const config = opsConfig();
  if (!config.url || !config.publishableKey) {
    throw apiFailure("auth_unavailable", "Authentication is unavailable.", 503);
  }
  if (!cachedAuthClient) {
    cachedAuthClient = createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "m2m-golf-operations-auth/1.0" } },
    });
  }
  return cachedAuthClient;
}

export function apiFailure(code, message, status = 400, fieldErrors) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (fieldErrors) error.fieldErrors = fieldErrors;
  return error;
}

export function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.end(JSON.stringify(payload));
}

export function sendError(res, error, fallback = "The request could not be completed.") {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = typeof error?.code === "string" ? error.code : "unexpected_error";
  if (status >= 500) {
    console.error("[M2M Operations] request failed", { code, message: error?.message || fallback });
  }
  sendJson(res, status, {
    ok: false,
    code,
    message: status >= 500 && code === "unexpected_error" ? fallback : error?.message || fallback,
    ...(error?.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
  });
}

export function parseJsonBody(req, maximumBytes = 100_000) {
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw apiFailure("content_type_invalid", "JSON content is required.", 415);
  }
  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
  if (Buffer.byteLength(raw, "utf8") > maximumBytes) {
    throw apiFailure("payload_too_large", "The submitted data is too large.", 413);
  }
  try {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    throw apiFailure("json_invalid", "The submitted JSON could not be read.", 400);
  }
}

function bearerToken(req) {
  const authorization = clean(req.headers?.authorization);
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

export async function requireProfile(req, roles = []) {
  const token = bearerToken(req);
  if (!token) throw apiFailure("authentication_required", "Sign in is required.", 401);
  // Validate the user's bearer token with the same public Auth credentials used
  // by the browser. Keep the secret client reserved for privileged data access.
  const { data: authData, error: authError } = await authClient().auth.getUser(token);
  if (authError || !authData?.user?.id) {
    throw apiFailure("session_invalid", "Your session has expired. Sign in again.", 401);
  }
  const client = adminClient();
  const { data: profile, error: profileError } = await client
    .from("m2m_profiles")
    .select("id,email,full_name,role,is_active,last_seen_at")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw fromSupabase(profileError, "profile_load_failed");
  if (!profile?.is_active) throw apiFailure("account_inactive", "This account is not active.", 403);
  if (roles.length > 0 && !roles.includes(profile.role)) {
    throw apiFailure("permission_denied", "You do not have permission to perform this action.", 403);
  }
  return { ...profile, token, authUser: authData.user };
}

export async function requireAdmin(req) {
  return requireProfile(req, ["admin", "super_admin"]);
}

export async function requireSuperAdmin(req) {
  return requireProfile(req, ["super_admin"]);
}

export function fromSupabase(error, fallbackCode = "database_error", fallbackMessage) {
  const known = {
    m2m_sponsorship_capacity_exceeded: ["sponsorship_capacity_exceeded", "This sponsorship inventory is already fully reserved."],
    m2m_sponsorship_capacity_below_committed: ["sponsorship_capacity_committed", "Capacity cannot be reduced below reserved and confirmed inventory."],
    m2m_allocated_units_prevent_quantity_reduction: ["allocated_units", "Remove hole allocations before reducing this quantity."],
    m2m_tee_slot_already_assigned: ["tee_slot_unavailable", "That start slot has already been assigned."],
    m2m_hole_slot_already_allocated: ["hole_slot_unavailable", "That sponsorship slot has already been allocated."],
    m2m_hole_slot_type_mismatch: ["hole_slot_type_mismatch", "That sponsorship cannot use this hole slot."],
    m2m_sponsorship_must_be_confirmed: ["sponsorship_not_confirmed", "Confirm the sponsorship before allocating it."],
    m2m_fourball_must_be_confirmed: ["fourball_not_confirmed", "Confirm the fourball before assigning a start slot."],
    m2m_player_deadline_passed: ["deadline_passed", "The player-information deadline has passed."],
    m2m_player_details_incomplete: ["players_incomplete", "Complete all required player details before submitting."],
    m2m_custom_player_details_incomplete: ["players_incomplete", "Complete all required event questions before submitting."],
    m2m_privacy_notice_version_mismatch: ["privacy_notice_updated", "Review the current privacy notice before submitting."],
    m2m_event_setup_incomplete: ["event_setup_incomplete", "Complete the required event setup before activation."],
  };
  const message = String(error?.message || "");
  const match = Object.entries(known).find(([needle]) => message.includes(needle));
  if (match) return apiFailure(match[1][0], match[1][1], 409);
  if (error?.code === "23505") return apiFailure("duplicate_record", fallbackMessage || "That record already exists.", 409);
  return apiFailure(fallbackCode, fallbackMessage || "The database request failed.", 503);
}

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw apiFailure("validation_failed", "Check the highlighted information and try again.", 400, fieldErrors);
}

export async function recordAudit({ eventId = null, actorId, action, entityType, entityId, metadata = {} }) {
  const { error } = await adminClient().from("m2m_audit_events").insert({
    event_id: eventId,
    actor_profile_id: actorId,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    metadata,
  });
  if (error) console.warn("[M2M Operations] audit write failed", { action, code: error.code });
}

export function requestOrigin(req) {
  const host = clean(req.headers?.["x-forwarded-host"] || req.headers?.host).split(",")[0];
  const protocol = clean(req.headers?.["x-forwarded-proto"]).split(",")[0] || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export function publicProfile(profile) {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    isActive: Boolean(profile.is_active),
    lastSeenAt: profile.last_seen_at || null,
  };
}

export async function sendOperationalEmail({ to, subject, html }) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const fromEmail = clean(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !fromEmail) return { status: "skipped", providerId: null, failureCode: "resend_not_configured" };
  const fromName = clean(process.env.RESEND_FROM_NAME) || "M2M Golf Day";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        html,
        ...(clean(process.env.RESEND_REPLY_TO) ? { reply_to: clean(process.env.RESEND_REPLY_TO) } : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? { status: "sent", providerId: payload.id || null, failureCode: null }
      : { status: "failed", providerId: null, failureCode: payload.name || `resend_${response.status}` };
  } catch (error) {
    return { status: "failed", providerId: null, failureCode: error?.name || "resend_request_failed" };
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

export async function requireHostAssignment(profileId, eventId, fourballId) {
  const { data, error } = await adminClient()
    .from("m2m_fourball_hosts")
    .select("id,is_primary,invited_at,accepted_at")
    .eq("profile_id", profileId)
    .eq("event_id", eventId)
    .eq("fourball_id", fourballId)
    .maybeSingle();
  if (error) throw fromSupabase(error, "host_assignment_failed");
  if (!data) throw apiFailure("fourball_access_denied", "You are not assigned to this fourball.", 403);
  return data;
}
