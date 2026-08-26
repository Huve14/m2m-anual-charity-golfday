import { readAdminSession, sendJson } from "./_admin-auth.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const session = readAdminSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, message: "Admin sign-in required." });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    admin: { email: session.email },
    expiresAt: new Date(session.exp * 1000).toISOString(),
  });
}
