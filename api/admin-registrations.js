import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";

const TABLE = process.env.SUPABASE_REGISTRATION_TABLE || "m2m_registrations";
const URL = String(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
).trim().replace(/\/$/, "");
const KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.service_role ||
  process.env.SUPABASE_SERVICE_ROLE_SECRET ||
  "";

const SELECT_COLUMNS = [
  "registration_id",
  "submitted_at",
  "status",
  "source",
  "username",
  "account_status",
  "email",
  "first_name",
  "surname",
  "contact_name",
  "company",
  "phone",
  "package_choice",
  "sponsorship_option",
  "sponsorship_label",
  "sponsorship_amount",
  "fourball_count",
  "fourball_amount",
  "player_slots",
  "player_names_text",
  "players",
  "dietary_requirements",
  "dietary_other",
  "notes",
  "total_amount",
  "privacy_notice_version",
  "registration_consent",
  "player_data_consent",
  "marketing_consent",
  "consented_at",
  "consent_tags",
].join(",");
const REGISTRATION_ID_PATTERN = /^M2M-[A-Z0-9]{6,32}$/;

function supabaseHeaders() {
  const headers = {
    apikey: KEY,
    Accept: "application/json",
    Prefer: "count=exact",
    "Accept-Profile": "public",
  };
  if (!KEY.startsWith("sb_secret_")) headers.Authorization = `Bearer ${KEY}`;
  return headers;
}

function configured() {
  return Boolean(URL && KEY && TABLE);
}

function parseTotal(contentRange, fallback) {
  const total = Number(String(contentRange || "").split("/").at(-1));
  return Number.isFinite(total) ? total : fallback;
}

function requestedRegistrationId(req) {
  const rawId = Array.isArray(req.query?.id) ? "" : req.query?.id;
  const id = typeof rawId === "string" ? rawId.trim().toUpperCase() : "";
  return REGISTRATION_ID_PATTERN.test(id) ? id : null;
}

async function deleteRegistration(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  if (!configured()) {
    sendJson(res, 503, { ok: false, message: "Registration storage is unavailable." });
    return;
  }

  const registrationId = requestedRegistrationId(req);
  if (!registrationId) {
    sendJson(res, 400, {
      ok: false,
      message: "Select a valid registration to delete.",
    });
    return;
  }

  try {
    const query = new URLSearchParams({
      registration_id: `eq.${registrationId}`,
      select: "registration_id,contact_name,company",
    });
    const response = await fetch(
      `${URL}/rest/v1/${encodeURIComponent(TABLE)}?${query}`,
      {
        method: "DELETE",
        headers: {
          ...supabaseHeaders(),
          Prefer: "return=representation",
          "Content-Profile": "public",
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) throw new Error(`supabase_${response.status}`);
    const deletedRows = await response.json();
    const deleted = Array.isArray(deletedRows) ? deletedRows[0] : null;
    if (!deleted) {
      sendJson(res, 404, {
        ok: false,
        message: "This registration no longer exists.",
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      deletedRegistration: {
        registrationId: deleted.registration_id,
        contactName: deleted.contact_name || "",
        company: deleted.company || "",
      },
    });
  } catch (error) {
    console.error("[M2M Invitational] admin registration deletion failed", {
      code: error?.message || "admin_registration_delete_failed",
      admin: session.email,
      registrationId,
    });
    sendJson(res, 503, {
      ok: false,
      message: "The registration could not be deleted right now.",
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "DELETE") {
    await deleteRegistration(req, res);
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, DELETE");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const session = await requireAdmin(req, res);
  if (!session) return;
  if (!configured()) {
    sendJson(res, 503, { ok: false, message: "Registration storage is unavailable." });
    return;
  }

  try {
    const query = new URLSearchParams({
      select: SELECT_COLUMNS,
      order: "submitted_at.desc",
      limit: "1000",
    });
    const response = await fetch(
      `${URL}/rest/v1/${encodeURIComponent(TABLE)}?${query}`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) throw new Error(`supabase_${response.status}`);
    const registrations = await response.json();
    if (!Array.isArray(registrations)) throw new Error("invalid_response");

    sendJson(res, 200, {
      ok: true,
      registrations,
      total: parseTotal(response.headers.get("content-range"), registrations.length),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[M2M Invitational] admin registrations read failed", {
      code: error?.message || "admin_read_failed",
      admin: session.email,
    });
    sendJson(res, 503, {
      ok: false,
      message: "The registrations could not be loaded right now.",
    });
  }
}

export const config = { maxDuration: 20 };
