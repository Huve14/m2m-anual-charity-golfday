import { portalSession, sendPortalJson } from "./_portal-auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendPortalJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const session = await portalSession(req, res);
  sendPortalJson(res, 200, {
    ok: true,
    authenticated: Boolean(session),
    email: session?.user?.email || null,
  });
}

