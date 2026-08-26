import {
  expiredAdminCookie,
  isSameOrigin,
  sendJson,
} from "./_admin-auth.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  res.setHeader("Set-Cookie", expiredAdminCookie());
  sendJson(res, 200, { ok: true });
}
