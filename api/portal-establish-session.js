import { isSameOrigin } from "./_admin-auth.js";
import { sendPortalJson, setPortalCookies } from "./_portal-auth.js";
import { authRequest } from "./_host-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendPortalJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!isSameOrigin(req)) {
    sendPortalJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const accessToken = String(body?.accessToken || "");
    const refreshToken = String(body?.refreshToken || "");
    if (accessToken.length < 100 || refreshToken.length < 20) throw new Error("invalid_invite_session");
    const user = await authRequest("user", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setPortalCookies(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
    });
    sendPortalJson(res, 200, { ok: true, email: user.email, requiresPassword: true });
  } catch {
    sendPortalJson(res, 401, { ok: false, message: "This access link is invalid or has expired." });
  }
}

