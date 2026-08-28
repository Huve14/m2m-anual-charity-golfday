import { isSameOrigin } from "./_admin-auth.js";
import { clearPortalCookies, sendPortalJson } from "./_portal-auth.js";

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
  clearPortalCookies(res);
  sendPortalJson(res, 200, { ok: true });
}

