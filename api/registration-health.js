function isConfigured(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function send(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseRole =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.service_role ||
    process.env.SUPABASE_SERVICE_ROLE_SECRET;
  const configured = isConfigured(supabaseUrl) && isConfigured(supabaseRole);
  if (!configured) {
    send(res, 503, { ok: false, service: "registration" });
    return;
  }

  const storageRelation =
    process.env.SUPABASE_REGISTRATION_TABLE || "m2m_registrations";
  const baseUrl = String(supabaseUrl).trim().replace(/\/$/, "");
  const headers = {
    apikey: supabaseRole,
    Accept: "application/json",
    "Content-Profile": "public",
  };
  if (!supabaseRole.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${supabaseRole}`;
  }

  let ready = false;
  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/${encodeURIComponent(storageRelation)}?select=registration_id&limit=0`,
      { headers },
    );
    ready = response.ok;
    if (!ready) {
      let storageHost = "invalid";
      try {
        storageHost = new URL(baseUrl).hostname;
      } catch {
        // The hostname classification is diagnostic only.
      }
      console.error("[M2M Invitational] registration health check failed", {
        status: response.status,
        storageHost,
      });
    }
  } catch {
    ready = false;
  }

  send(res, ready ? 200 : 503, {
    ok: ready,
    service: "registration",
  });
}
