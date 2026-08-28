import { requireAdmin, sendJson } from "./_admin-auth.js";
import { serviceRest } from "./_host-store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const query = new URLSearchParams({
      select: "id,file_name,status,uploaded_by_admin_email,total_rows,valid_rows,invalid_rows,additions,updates,duplicates,hole_conflicts,committed_at,created_at",
      order: "created_at.desc",
      limit: "100",
    });
    const { payload } = await serviceRest("host_import_batches", query.toString());
    sendJson(res, 200, { ok: true, batches: Array.isArray(payload) ? payload : [] });
  } catch (error) {
    console.error("[M2M Invitational] import history failed", {
      admin: admin.email,
      code: error?.code || "import_history_failed",
    });
    sendJson(res, 503, { ok: false, message: "Import history could not be loaded right now." });
  }
}

