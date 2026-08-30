const DEFAULT_TIMEOUT_MS = 15_000;

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normaliseEmail(value) {
  return stringValue(value).toLowerCase();
}

export function supabaseUrl() {
  return stringValue(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/$/, "");
}

export function serviceKey() {
  return stringValue(
    process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      process.env.service_role ||
      process.env.SUPABASE_SERVICE_ROLE_SECRET,
  );
}

export function publishableKey() {
  return stringValue(
    process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY,
  );
}

export function hostStoreConfigured() {
  return Boolean(supabaseUrl() && serviceKey());
}

function bearerHeaders(key, extra = {}) {
  const headers = { apikey: key, Accept: "application/json", ...extra };
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

async function readPayload(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function providerError(payload, response) {
  const error = new Error("host_store_failed");
  error.code = payload?.code || "host_store_failed";
  error.providerMessage = stringValue(payload?.message || payload?.error_description);
  error.status = response.status;
  return error;
}

export async function serviceRest(table, query = "", init = {}) {
  if (!hostStoreConfigured()) {
    const error = new Error("host_store_unavailable");
    error.status = 503;
    throw error;
  }
  const { prefer = "", headers: extraHeaders = {}, ...requestInit } = init;
  const suffix = query ? `?${query}` : "";
  const key = serviceKey();
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/${encodeURIComponent(table)}${suffix}`,
    {
      ...requestInit,
      headers: bearerHeaders(key, {
        "Accept-Profile": "public",
        "Content-Profile": "public",
        ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
        ...extraHeaders,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw providerError(payload, response);
  return { payload, response };
}

export async function serviceRpc(functionName, body) {
  const key = serviceKey();
  if (!supabaseUrl() || !key) {
    const error = new Error("host_store_unavailable");
    error.status = 503;
    throw error;
  }
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers: bearerHeaders(key, {
        "Content-Type": "application/json",
        "Content-Profile": "public",
        "Accept-Profile": "public",
      }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw providerError(payload, response);
  return payload;
}

export async function userRest(accessToken, table, query = "", init = {}) {
  const key = publishableKey();
  if (!supabaseUrl() || !key || !stringValue(accessToken)) {
    const error = new Error("portal_store_unavailable");
    error.status = 503;
    throw error;
  }
  const { prefer = "", headers: extraHeaders = {}, ...requestInit } = init;
  const suffix = query ? `?${query}` : "";
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/${encodeURIComponent(table)}${suffix}`,
    {
      ...requestInit,
      headers: {
        ...bearerHeaders(key, {
          "Accept-Profile": "public",
          "Content-Profile": "public",
          ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
          ...(prefer ? { Prefer: prefer } : {}),
          ...extraHeaders,
        }),
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw providerError(payload, response);
  return { payload, response };
}

export async function userRpc(accessToken, functionName, body) {
  const key = publishableKey();
  if (!supabaseUrl() || !key || !stringValue(accessToken)) {
    const error = new Error("portal_store_unavailable");
    error.status = 503;
    throw error;
  }
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers: {
        ...bearerHeaders(key, {
          "Content-Type": "application/json",
          "Content-Profile": "public",
          "Accept-Profile": "public",
        }),
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw providerError(payload, response);
  return payload;
}

export async function authRequest(path, init = {}, useServiceKey = false) {
  const key = useServiceKey ? serviceKey() : publishableKey();
  if (!supabaseUrl() || !key) {
    const error = new Error("portal_auth_unavailable");
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${supabaseUrl()}/auth/v1/${path}`, {
    ...init,
    headers: bearerHeaders(key, {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw providerError(payload, response);
  return payload;
}
