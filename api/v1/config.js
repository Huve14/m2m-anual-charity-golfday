import { opsConfig, sendError, sendJson } from "../_ops.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    const config = opsConfig();
    if (!config.url || !config.publishableKey) {
      throw Object.assign(new Error("Authentication is not configured."), { code: "auth_unavailable", status: 503 });
    }
    sendJson(res, 200, { ok: true, supabaseUrl: config.url, publishableKey: config.publishableKey });
  } catch (error) {
    sendError(res, error);
  }
}

