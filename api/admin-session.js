import { requireAdmin, sendJson } from "./_admin-auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  sendJson(res, 200, {
    ok: true,
    admin: {
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
    },
    expiresAt: new Date(admin.exp * 1000).toISOString(),
  });
}
