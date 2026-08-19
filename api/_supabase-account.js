import { randomBytes } from "node:crypto";

const PASSWORD_LENGTH = 26;
const USERNAME_SUFFIX_LENGTH = 4;
const USERNAME_MAX_LENGTH = 30;
const SPONSORSHIP_LABELS = Object.freeze({
  "": "No hole sponsorship",
  "with-alcohol": "Hole sponsorship with alcohol",
  "without-alcohol": "Hole sponsorship without alcohol",
});
const SUPABASE_REGISTRATION_TABLE =
  process.env.SUPABASE_REGISTRATION_TABLE || "m2m_registrations";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM_ADDRESS;
const RESEND_FROM_NAME =
  process.env.RESEND_FROM_NAME ||
  process.env.EMAIL_FROM_NAME ||
  "M2M Charity Golf Day";
const RESEND_REPLY_TO =
  process.env.RESEND_REPLY_TO || process.env.EMAIL_REPLY_TO || RESEND_FROM_EMAIL;

function normaliseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function isConfigured(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function buildCredentialsEmailHtml(username, temporaryPassword, email) {
  const safeEmail = String(email || "").trim();
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f4f7fc;font-family:Arial, Helvetica, sans-serif;color:#13243f;line-height:1.6;">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #d7dfef;border-radius:12px;padding:28px;">
    <h2 style="margin:0 0 12px;color:#13243f;font-size:22px;line-height:1.3;">Your M2M Golf Day login credentials</h2>
    <p style="margin:0 0 16px;">Hi ${safeEmail}, your registration was received and your account has been created.</p>
    <p style="margin:0 0 8px;"><strong>Username:</strong> ${username}</p>
    <p style="margin:0 0 8px;"><strong>Temporary password:</strong> <span style="font-family:Menlo, Monaco, Consolas, 'Courier New', monospace;display:inline-block;background:#eef3ff;padding:2px 6px;border-radius:6px;">${temporaryPassword}</span></p>
    <p style="margin:14px 0 0;font-size:14px;color:#4b5871;">Please change your password after first sign in.</p>
    <p style="margin:14px 0 0;font-size:14px;color:#4b5871;">Welcome to M2M Charity Golf Day.</p>
  </div>
</body>
</html>`;
}

async function sendCredentialsEmail(details, username, temporaryPassword) {
  if (!isConfigured(RESEND_API_KEY) || !isConfigured(RESEND_FROM_EMAIL)) {
    return {
      status: "skipped",
      reason: "Email credentials are not fully configured.",
    };
  }

  const toEmail = String(details?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { status: "error", reason: "Invalid recipient email address." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [toEmail],
      reply_to: RESEND_REPLY_TO,
      subject: "Your M2M Charity Golf Day account credentials",
      html: buildCredentialsEmailHtml(username, temporaryPassword, toEmail),
      text: `Your M2M Golf Day account credentials.

Username: ${username}
Temporary password: ${temporaryPassword}

Please change your password after first sign in.`,
    }),
  });

  let emailBody = null;
  const bodyText = await response.text();
  if (bodyText) {
    try {
      emailBody = JSON.parse(bodyText);
    } catch {
      emailBody = { message: bodyText };
    }
  }

  if (!response.ok) {
    const reason =
      emailBody?.message ||
      emailBody?.error ||
      `Unable to send email (${response.status}).`;
    return {
      status: "error",
      reason: String(reason),
      statusCode: response.status,
      providerResponse: emailBody,
    };
  }

  return {
    status: "sent",
    provider: "resend",
    messageId: emailBody?.id || emailBody?.message_id || null,
  };
}

const SUPABASE_URL = normaliseUrl(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.service_role ||
  process.env.SUPABASE_SERVICE_ROLE_SECRET;

function authConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function headers() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

function restHeaders() {
  return {
    ...headers(),
    Prefer: "return=minimal",
    "Content-Profile": "public",
  };
}

function makeError(message, status, body) {
  const error = new Error(message);
  error.status = status;
  error.body = body;
  return error;
}

function randomString(length, chars) {
  const randomSource = randomBytes(length);
  return Array.from(randomSource, (byte) => chars[byte % chars.length]).join("");
}

function randomPassword(length = PASSWORD_LENGTH) {
  return randomString(
    length,
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+",
  );
}

function randomAlnum(length = USERNAME_SUFFIX_LENGTH) {
  return randomString(length, "abcdefghijklmnopqrstuvwxyz0123456789");
}

function buildUsernameBase(email) {
  const local = email.split("@")[0]?.toLowerCase?.() || "";
  const base = local
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return base || "m2m-player";
}

function buildUsernameFromEmail(email) {
  const base = buildUsernameBase(email).slice(0, USERNAME_MAX_LENGTH - (USERNAME_SUFFIX_LENGTH + 1));
  const suffix = randomAlnum(USERNAME_SUFFIX_LENGTH);
  const username = `${base}-${suffix}`.slice(0, USERNAME_MAX_LENGTH);
  return username;
}

async function requestSupabaseAuth(path, init = {}) {
  if (!authConfigured()) {
    const missing = new Error("Supabase credentials are not configured.");
    missing.status = 503;
    throw missing;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      ...headers(),
      ...(init.headers || {}),
    },
  });

  let payload = null;
  const bodyText = await response.text();
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = { message: bodyText };
    }
  }

  if (!response.ok) {
    const message =
      payload?.msg ||
      payload?.message ||
      `Supabase auth request failed (${response.status})`;
    throw makeError(message, response.status, payload);
  }

  return payload;
}

async function requestSupabaseRest(path, init = {}) {
  if (!authConfigured()) {
    const missing = new Error("Supabase credentials are not configured.");
    missing.status = 503;
    throw missing;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      ...restHeaders(),
      ...(init.headers || {}),
    },
  });

  let payload = null;
  const bodyText = await response.text();
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = { message: bodyText };
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.details ||
      `Supabase rest request failed (${response.status})`;
    throw makeError(message, response.status, payload);
  }

  return payload;
}

function buildAuthMetadata(details, username) {
  const {
    firstName,
    surname,
    email,
    cellPhone,
    company,
    contactName,
    packageChoice,
    dietary,
    dietaryOther,
    registrationId,
    submittedAt,
    notes,
    fourballs,
    sponsorship,
    sponsorshipAmount,
    fourballAmount,
    totalAmount,
  } = details;

  return {
    registrationId,
    submittedAt,
    username,
    chosenPackage: packageChoice,
    dietaryRequirements: dietary,
    dietaryOther: dietaryOther || null,
    firstName,
    surname,
    contactName,
    company,
    phone: cellPhone,
    email,
    notes,
    fourballs,
    sponsorship,
    sponsorshipAmount,
    fourballAmount,
    totalAmount,
    source: "m2m-charity-golf-day",
    accountType: "registration",
    createdBy: "auto-registration-flow",
  };
}

function pickExistingUsername(user, email) {
  return (
    user?.user_metadata?.username &&
    typeof user.user_metadata.username === "string" &&
    user.user_metadata.username.trim().length > 0
      ? user.user_metadata.username.trim().slice(0, USERNAME_MAX_LENGTH)
      : buildUsernameFromEmail(email)
  );
}

async function findUserByEmail(email) {
  const encodedEmail = encodeURIComponent(email.toLowerCase());
  const payload = await requestSupabaseAuth(`/users?email=${encodedEmail}`, {
    method: "GET",
  });
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.find(
    (user) => user?.email?.toLowerCase?.() === email.toLowerCase(),
  );
}

async function createUser(details, username, password) {
  const metadata = buildAuthMetadata(details, username);
  return requestSupabaseAuth("/users", {
    method: "POST",
    body: JSON.stringify({
      email: details.email,
      password,
      email_confirm: true,
      phone: details.cellPhone || undefined,
      user_metadata: metadata,
      app_metadata: { provider: "email" },
    }),
  });
}

async function updateUser(id, details, username, password) {
  const metadata = buildAuthMetadata(details, username);
  return requestSupabaseAuth(`/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      email: details.email,
      password,
      phone: details.cellPhone || undefined,
      email_confirm: true,
      user_metadata: metadata,
    }),
  });
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatPlayerRows(players = []) {
  if (!Array.isArray(players)) return [];
  return players
    .filter((player) => player?.name || player?.handicap)
    .map((player) => ({
      name: String(player.name || "").trim(),
      handicap: String(player.handicap || "").trim(),
      hcp_raw: player.handicapRaw || null,
    }));
}

function buildPlayerText(players = []) {
  if (!Array.isArray(players) || players.length === 0) return "";
  return players
    .map(
      (player) =>
        `${String(player?.name || "").trim() || "Name to follow"}${player?.handicap ? `, HCP ${String(player.handicap).trim()}` : ""}`,
    )
    .join("\n");
}

function buildRegistrationRow(details, userContext, registrationRecord = null) {
  const players = formatPlayerRows(
    Array.isArray(details.players) && details.players.length > 0
      ? details.players
      : [],
  );
  const fourballs = toNumber(details.fourballs);
  const fourballAmount = toNumber(details.fourballAmount);
  const sponsorshipAmount = toNumber(details.sponsorshipAmount);
  const playerSlots = toNumber(details.playerSlots || fourballs * 4);

  return {
    registration_id: details.registrationId,
    submitted_at: details.submittedAt || new Date().toISOString(),
    status: details.status || "new",
    status_source: details.statusSource || "website",
    source: "website",
    user_id: userContext.userId || null,
    username: userContext.username || null,
    email: details.email,
    first_name: details.firstName || null,
    surname: details.surname || null,
    contact_name: details.contactName || `${details.firstName || ""} ${details.surname || ""}`.trim() || null,
    company: details.company || null,
    phone: details.cellPhone || null,
    package_choice: details.packageChoice || "Four-ball package",
    fourball_count: fourballs,
    player_slots: playerSlots,
    player_names_text: details.playerNamesText || buildPlayerText(players),
    dietary_requirements: details.dietary || null,
    dietary_other: details.dietaryOther || null,
    notes: details.notes || null,
    sponsorship_option: details.sponsorship || "No hole sponsorship",
    sponsorship_label:
      details.sponsorship && SPONSORSHIP_LABELS[details.sponsorship]
        ? SPONSORSHIP_LABELS[details.sponsorship]
        : "No hole sponsorship",
    sponsorship_amount: sponsorshipAmount,
    fourball_amount: fourballAmount,
    total_amount: toNumber(details.totalAmount),
    raw_registration: registrationRecord || {},
    players,
  };
}

async function insertRegistrationRecord(details, userContext, registrationRecord) {
  const payload = buildRegistrationRow(details, userContext, registrationRecord);

  try {
    await requestSupabaseRest(`/${SUPABASE_REGISTRATION_TABLE}`, {
      method: "POST",
      body: JSON.stringify([payload]),
    });
    return "inserted";
  } catch (error) {
    if (
      error?.status === 409 &&
      (String(error?.message || "").includes("duplicate key value") ||
        String(error?.message || "").includes("23505"))
    ) {
      return "duplicate";
    }
    throw error;
  }
}

export async function createOrUpdateRegistrationAccount(details, registrationRecord) {
  if (!authConfigured()) {
    return {
      status: "skipped",
      reason: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured.",
    };
  }

  const email = details.email?.toLowerCase?.();
  if (!email) {
    return {
      status: "skipped",
      reason: "No email was provided for account creation.",
    };
  }

  const username = buildUsernameFromEmail(email);
  const temporaryPassword = randomPassword();

  try {
    const existingUser = await findUserByEmail(email);
    const userName = pickExistingUsername(existingUser, email);
    const user = existingUser?.id
      ? await updateUser(existingUser.id, details, userName, temporaryPassword)
      : await createUser(details, username, temporaryPassword);
    const userId = user?.id || user?.user?.id || existingUser?.id || null;

    const userContext = {
      status: existingUser?.id ? "updated" : "created",
      userId,
      username: existingUser?.id ? pickExistingUsername(existingUser, email) : username,
      temporaryPassword,
    };

    const registrationStatus = await insertRegistrationRecord(
      details,
      userContext,
      registrationRecord || {},
    );
    const emailStatus = await sendCredentialsEmail(
      details,
      userContext.username,
      temporaryPassword,
    );

    return {
      ...userContext,
      registrationStatus,
      emailStatus,
    };
  } catch (error) {
    return {
      status: "error",
      reason:
        error instanceof Error
          ? error.message
          : "Unexpected error while creating registration account.",
    };
  }
}
