import { randomBytes } from "node:crypto";

function normaliseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

const SUPABASE_URL = normaliseUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
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

function makeError(message, status, body) {
  const error = new Error(message);
  error.status = status;
  error.body = body;
  return error;
}

function randomPassword() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  const randomSource = randomBytes(30);
  const bytes = new Uint8Array(randomSource);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

async function requestSupabase(path, init = {}) {
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
    const message = payload?.msg || payload?.message || `Supabase request failed (${response.status})`;
    throw makeError(message, response.status, payload);
  }
  return payload;
}

async function findUserByEmail(email) {
  const encodedEmail = encodeURIComponent(email.toLowerCase());
  const payload = await requestSupabase(`/users?email=${encodedEmail}`, {
    method: "GET",
  });
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.find(
    (user) => user?.email?.toLowerCase?.() === email.toLowerCase(),
  );
}

function buildMetadata(details) {
  const {
    firstName,
    surname,
    email,
    cellPhone,
    company,
    contactName,
    packageChoice,
    dietary,
    registrationId,
  } = details;

  return {
    registrationId,
    chosenPackage: packageChoice,
    dietaryRequirements: dietary,
    firstName,
    surname,
    contactName,
    company,
    phone: cellPhone,
    email,
    source: "m2m-charity-golf-day",
    accountType: "registration",
    createdBy: "auto-registration-flow",
  };
}

async function createUser(details) {
  const metadata = buildMetadata(details);
  return requestSupabase("/users", {
    method: "POST",
    body: JSON.stringify({
      email: details.email,
      password: randomPassword(),
      email_confirm: true,
      phone: details.cellPhone || undefined,
      user_metadata: metadata,
      app_metadata: { provider: "email" },
    }),
  });
}

async function updateUser(id, details) {
  const metadata = buildMetadata(details);
  return requestSupabase(`/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      email_confirm: true,
      user_metadata: metadata,
    }),
  });
}

export async function createOrUpdateRegistrationAccount(details) {
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

  const existingUser = await findUserByEmail(email);
  if (existingUser?.id) {
    const user = await updateUser(existingUser.id, details);
    return {
      status: "updated",
      userId: user.id || existingUser.id,
    };
  }

  const user = await createUser(details);
  return {
    status: "created",
    userId: user.id,
  };
}
