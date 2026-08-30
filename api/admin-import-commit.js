import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";
import { serviceRpc } from "./_host-store.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const batchId = String(req.query?.batchId || body?.batchId || "");
    if (!UUID_PATTERN.test(batchId) || body?.confirmed !== true) {
      sendJson(res, 400, { ok: false, message: "Confirm a valid import preview first." });
      return;
    }
    const result = await serviceRpc("m2m_commit_host_import", {
      p_batch_id: batchId,
      p_administrator_id: admin.id,
      p_administrator_email: admin.email,
    });
    sendJson(res, 200, { ok: true, result });
  } catch (error) {
    const conflict = error?.code === "23505" || error?.providerMessage?.includes("conflict");
    console.error("[M2M Invitational] import commit failed", {
      admin: admin.email,
      code: error?.code || "import_commit_failed",
    });
    sendJson(res, conflict ? 409 : 503, {
      ok: false,
      message: conflict
        ? "The import changed after preview. Review company and hole conflicts, then preview again."
        : "The import could not be committed. No partial host records were saved.",
    });
  }
}

export const config = { maxDuration: 45 };
