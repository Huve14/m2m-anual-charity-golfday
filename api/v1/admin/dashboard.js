import { loadDashboardData } from "../../_dashboard-data.js";
import { adminClient, requireAdmin, sendError, sendJson } from "../../_ops.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    await requireAdmin(req);
    const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
    if (!eventId) throw Object.assign(new Error("Select an event."), { code: "event_required", status: 400 });
    const client = adminClient();
    sendJson(res, 200, await loadDashboardData(client, eventId));
  } catch (error) {
    sendError(res, error, "The event overview could not be loaded.");
  }
}

export const config = { maxDuration: 30 };
