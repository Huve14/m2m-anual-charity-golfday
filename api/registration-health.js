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

export default function handler(req, res) {
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
  const ready = isConfigured(supabaseUrl) && isConfigured(supabaseRole);

  send(res, ready ? 200 : 503, {
    ok: ready,
    service: "registration",
  });
}
