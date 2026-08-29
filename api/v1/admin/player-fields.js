import { z } from "zod";
import { adminClient, fromSupabase, parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const schema = z.object({
  eventId: z.string().uuid(),
  id: z.string().uuid().optional(),
  action: z.enum(["create", "update", "delete"]).default("create"),
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  label: z.string().trim().min(2).max(160).optional(),
  type: z.enum(["text", "number", "select", "checkbox"]).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  required: z.boolean().default(false),
});

export default async function handler(req, res) {
  try {
    const actor = await requireAdmin(req);
    const client = adminClient();
    if (req.method === "GET") {
      const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
      const { data, error } = await client.from("m2m_event_player_fields").select("*").eq("event_id", eventId).order("sort_order");
      if (error) throw fromSupabase(error, "fields_load_failed");
      sendJson(res, 200, { ok: true, fields: data.map((item) => ({ id: item.id, key: item.field_key, label: item.label, type: item.field_type, options: item.options || [], required: item.is_required })) });
      return;
    }
    if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST, PATCH, DELETE");
      sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
      return;
    }
    const input = validate(schema, parseJsonBody(req));
    let id = input.id;
    if (input.action === "delete" || req.method === "DELETE") {
      const { error } = await client.from("m2m_event_player_fields").delete().eq("id", input.id).eq("event_id", input.eventId);
      if (error) throw fromSupabase(error, "field_delete_failed");
    } else if (input.action === "update" || req.method === "PATCH") {
      const changes = {};
      if (input.key !== undefined) changes.field_key = input.key;
      if (input.label !== undefined) changes.label = input.label;
      if (input.type !== undefined) changes.field_type = input.type;
      changes.options = input.options;
      changes.is_required = input.required;
      const { error } = await client.from("m2m_event_player_fields").update(changes).eq("id", input.id).eq("event_id", input.eventId);
      if (error) throw fromSupabase(error, "field_update_failed");
    } else {
      const { data, error } = await client.from("m2m_event_player_fields").insert({ event_id: input.eventId, field_key: input.key, label: input.label, field_type: input.type || "text", options: input.options, is_required: input.required }).select("id").single();
      if (error) throw fromSupabase(error, "field_create_failed");
      id = data.id;
    }
    await recordAudit({ eventId: input.eventId, actorId: actor.id, action: `player_field.${input.action}`, entityType: "event_player_field", entityId: id });
    sendJson(res, 200, { ok: true, id });
  } catch (error) {
    sendError(res, error, "The player-field request failed.");
  }
}

export const config = { maxDuration: 30 };

