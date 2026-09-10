import { z } from "zod";
import { adminClient, apiFailure, fromSupabase, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";
import { buildExportSheets, exportTypes, loadExportData } from "../../_export-data.js";
import { createExportWorkbook, EXCEL_CONTENT_TYPE } from "../../_export-workbook.js";

const schema = z.object({ eventId: z.string().uuid(), type: z.enum(exportTypes).default("players") });

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    const actor = await requireAdmin(req);
    const { eventId, type } = validate(schema, req.query || {});
    const client = adminClient();
    const { data: event, error } = await client.from("m2m_events").select("id,name,slug,venue_name,shotgun_start_at,timezone,currency,primary_colour,accent_colour").eq("id", eventId).maybeSingle();
    if (error) throw fromSupabase(error);
    if (!event) throw apiFailure("event_not_found", "This event could not be found.", 404);
    const data = await loadExportData(client, eventId, type);
    const generatedAt = new Date();
    const workbook = await createExportWorkbook(event, buildExportSheets(data, type), generatedAt);
    await recordAudit({ eventId, actorId: actor.id, action: "event.exported", entityType: "event", entityId: eventId, metadata: { type, format: "xlsx" } });
    const slug = String(event.slug || "event").replace(/[^a-z0-9-]/gi, "-").slice(0, 80);
    res.status(200);
    res.setHeader("Content-Type", EXCEL_CONTENT_TYPE);
    res.setHeader("Content-Disposition", `attachment; filename="m2m-${slug}-${type}-${generatedAt.toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(workbook);
  } catch (error) {
    sendError(res, error, "The Excel export could not be created.");
  }
}

export const config = { maxDuration: 30 };
