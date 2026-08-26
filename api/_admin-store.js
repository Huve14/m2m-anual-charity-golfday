const ADMIN_TABLE = "m2m_admin_users";

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function supabaseUrl() {
  return stringValue(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/$/, "");
}

function supabaseKey() {
  return stringValue(
    process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.service_role ||
      process.env.SUPABASE_SERVICE_ROLE_SECRET,
  );
}

function adminTable() {
  return stringValue(process.env.SUPABASE_ADMIN_TABLE) || ADMIN_TABLE;
}

function headers(prefer = "") {
  const key = supabaseKey();
  const result = {
    apikey: key,
    Accept: "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };
  if (!key.startsWith("sb_secret_")) result.Authorization = `Bearer ${key}`;
  if (prefer) result.Prefer = prefer;
  return result;
}

function endpoint(query = "") {
  const suffix = query ? `?${query}` : "";
  return `${supabaseUrl()}/rest/v1/${encodeURIComponent(adminTable())}${suffix}`;
}

async function providerPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function storeError(code, status = 503, providerCode = null) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.providerCode = providerCode;
  return error;
}

async function request(query, init = {}) {
  if (!adminStoreConfigured()) throw storeError("admin_store_unavailable");
  const {
    prefer = "",
    headers: extraHeaders = {},
    ...requestInit
  } = init;
  const response = await fetch(endpoint(query), {
    ...requestInit,
    headers: {
      ...headers(prefer),
      ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await providerPayload(response);
  if (!response.ok) {
    const providerMessage = stringValue(payload?.message);
    const code =
      response.status === 409
        ? "admin_email_exists"
        : payload?.code === "P0001" && providerMessage === "m2m_last_super_admin"
          ? "last_super_admin"
          : "admin_store_failed";
    throw storeError(
      code,
      response.status,
      payload?.code || null,
    );
  }
  return payload;
}

export function adminStoreConfigured() {
  return Boolean(supabaseUrl() && supabaseKey() && adminTable());
}

export function normaliseAdminEmail(value) {
  return stringValue(value).toLowerCase();
}

export async function findAdminByEmail(email) {
  const query = new URLSearchParams({
    select:
      "id,email,display_name,password_hash,role,is_active,session_version,created_at,last_login_at",
    email: `eq.${normaliseAdminEmail(email)}`,
    limit: "1",
  });
  const rows = await request(query);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function findAdminById(id) {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId < 1) return null;
  const query = new URLSearchParams({
    select:
      "id,email,display_name,role,is_active,session_version,created_at,last_login_at",
    id: `eq.${numericId}`,
    limit: "1",
  });
  const rows = await request(query);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function listAdminUsers() {
  const query = new URLSearchParams({
    select:
      "id,email,display_name,role,is_active,created_at,last_login_at,created_by_email",
    order: "created_at.asc",
  });
  const rows = await request(query);
  if (!Array.isArray(rows)) throw storeError("admin_store_invalid_response");
  return rows;
}

export async function createAdminUser(record) {
  const rows = await request("select=id,email,display_name,role,is_active,created_at,last_login_at,created_by_email", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify([record]),
  });
  if (!Array.isArray(rows) || !rows[0]) {
    throw storeError("admin_store_invalid_response");
  }
  return rows[0];
}

export async function deleteAdminUser(id) {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId < 1) return null;
  const query = new URLSearchParams({
    select: "id,email,display_name,role,is_active",
    id: `eq.${numericId}`,
  });
  const rows = await request(query, {
    method: "DELETE",
    prefer: "return=representation",
  });
  if (!Array.isArray(rows)) throw storeError("admin_store_invalid_response");
  return rows[0] || null;
}

export async function recordAdminLogin(id) {
  const query = new URLSearchParams({ id: `eq.${Number(id)}` });
  await request(query, {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}
