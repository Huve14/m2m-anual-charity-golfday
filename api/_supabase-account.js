import { randomBytes } from "node:crypto";

const USERNAME_SUFFIX_LENGTH = 6;
const USERNAME_MAX_LENGTH = 30;
const SUPABASE_REGISTRATION_TABLE =
  process.env.SUPABASE_REGISTRATION_TABLE || "m2m_registrations";
const SUPABASE_URL = normaliseUrl(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const SUPABASE_SERVER_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.service_role ||
  process.env.SUPABASE_SERVICE_ROLE_SECRET;

const SPONSORSHIP_LABELS = Object.freeze({
  "": "No hole sponsorship",
  "with-alcohol": "Hole sponsorship with alcohol",
  "without-alcohol": "Hole sponsorship without alcohol",
});

function normaliseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function storageConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVER_KEY);
}

function restHeaders() {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVER_KEY,
    Prefer: "resolution=ignore-duplicates,return=minimal",
    "Content-Profile": "public",
  };
  if (!SUPABASE_SERVER_KEY.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${SUPABASE_SERVER_KEY}`;
  }
  return headers;
}

function makeStorageError(code, status, providerCode = null) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.providerCode = providerCode;
  return error;
}

function randomAlnum(length = USERNAME_SUFFIX_LENGTH) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    randomBytes(length),
    (byte) => chars[byte % chars.length],
  ).join("");
}

function buildUsernameBase(email) {
  const local = String(email || "").split("@")[0]?.toLowerCase?.() || "";
  const base = local
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return base || "m2m-player";
}

function buildUsernameFromEmail(email) {
  const suffix = randomAlnum();
  const maxBaseLength = USERNAME_MAX_LENGTH - suffix.length - 1;
  const base = buildUsernameBase(email).slice(0, maxBaseLength);
  return `${base}-${suffix}`;
}

function buildRegistrationRow(details, registrationRecord, username) {
  const players = Array.isArray(details.players)
    ? details.players
        .filter((player) => player?.name || player?.handicap)
        .map((player) => ({
          name: String(player.name || "").trim(),
          handicap: String(player.handicap || "").trim(),
        }))
    : [];
  const playerNamesText = players
    .map(
      (player) =>
        `${player.name || "Name to follow"}${
          player.handicap ? `, HCP ${player.handicap}` : ""
        }`,
    )
    .join("\n");

  return {
    registration_id: details.registrationId,
    submitted_at: details.submittedAt,
    status: "New",
    status_source: "website",
    source: "website",
    user_id: null,
    username,
    account_status: "pending_secure_invite",
    email: details.email,
    first_name: details.firstName,
    surname: details.surname,
    contact_name: details.contactName,
    company: details.company,
    phone: details.cellPhone,
    package_choice: details.packageChoice,
    sponsorship_option: details.sponsorship,
    sponsorship_label:
      SPONSORSHIP_LABELS[details.sponsorship] || "No hole sponsorship",
    sponsorship_amount: details.sponsorshipAmount,
    fourball_count: details.fourballs,
    fourball_amount: details.fourballAmount,
    player_slots: details.playerSlots,
    player_names_text: playerNamesText,
    players,
    dietary_requirements: details.dietary,
    dietary_other: details.dietaryOther,
    notes: details.notes,
    privacy_notice_version: details.privacyNoticeVersion,
    registration_consent: details.registrationConsent,
    player_data_consent: details.playerDataConsent,
    marketing_consent: details.marketingConsent,
    consented_at: details.consentedAt,
    consent_source: "website",
    consent_tags: details.consentTags,
    consent_text_snapshot: details.consentTextSnapshot,
    total_amount: details.totalAmount,
    raw_registration: registrationRecord || {},
  };
}

async function insertRegistrationRecord(details, registrationRecord, username) {
  if (!storageConfigured()) {
    throw makeStorageError("registration_storage_unavailable", 503);
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(SUPABASE_REGISTRATION_TABLE)}`,
    {
      method: "POST",
      headers: restHeaders(),
      body: JSON.stringify([
        buildRegistrationRow(details, registrationRecord, username),
      ]),
    },
  );

  if (response.ok) {
    return "inserted";
  }

  let providerCode = null;
  try {
    const payload = await response.json();
    providerCode = payload?.code || null;
  } catch {
    // Provider error bodies are intentionally not returned to the browser.
  }

  throw makeStorageError(
    "registration_storage_failed",
    response.status,
    providerCode,
  );
}

export async function storeRegistrationSecurely(details, registrationRecord) {
  const username = buildUsernameFromEmail(details.email);

  try {
    const registrationStatus = await insertRegistrationRecord(
      details,
      registrationRecord,
      username,
    );
    return {
      status: "stored",
      registrationStatus,
      accountProvisioning: "pending_secure_invite",
    };
  } catch (error) {
    console.error("[M2M Invitational] secure registration storage failed", {
      code: error?.code || "registration_storage_failed",
      status: Number.isInteger(error?.status) ? error.status : null,
      providerCode: error?.providerCode || null,
    });
    throw error;
  }
}
