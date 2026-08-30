import { z } from "zod";
import { adminClient, fromSupabase, parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const createSchema = z.object({
  eventId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  capacity: z.number().int().min(0).max(500),
  priceMinor: z.number().int().min(0),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
});

function shape(item) {
  return {
    id: item.id,
    eventId: item.event_id,
    name: item.name,
    capacity: item.capacity,
    priceMinor: item.price_minor,
    isActive: item.is_active,
    booked: Number(item.fourballs?.[0]?.count || 0),
  };
}

async function list(req, res) {
  await requireAdmin(req);
  const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
  const { data, error } = await adminClient()
    .from("m2m_fourball_types")
    .select("*,fourballs:m2m_fourballs(count)")
    .eq("event_id", eventId)
    .in("fourballs.booking_status", ["pending", "confirmed"])
    .order("sort_order")
    .order("name");
  if (error) throw fromSupabase(error, "fourball_types_load_failed", "Fourball types could not be loaded.");
  sendJson(res, 200, { ok: true, types: data.map(shape) });
}

async function create(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(createSchema, parseJsonBody(req));
  const { data, error } = await adminClient().from("m2m_fourball_types").insert({
    event_id: input.eventId, name: input.name, capacity: input.capacity,
    price_minor: input.priceMinor, is_active: input.isActive,
  }).select("*").single();
  if (error) throw fromSupabase(error, "fourball_type_create_failed", "The fourball type could not be created.");
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "fourball_type.created", entityType: "fourball_type", entityId: data.id });
  sendJson(res, 201, { ok: true, type: shape(data) });
}

async function update(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(updateSchema, parseJsonBody(req));
  const changes = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.capacity !== undefined) changes.capacity = input.capacity;
  if (input.priceMinor !== undefined) changes.price_minor = input.priceMinor;
  if (input.isActive !== undefined) changes.is_active = input.isActive;
  const { error } = await adminClient().from("m2m_fourball_types").update(changes).eq("id", input.id).eq("event_id", input.eventId);
  if (error) throw fromSupabase(error, "fourball_type_update_failed", "The fourball type could not be updated.");
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "fourball_type.updated", entityType: "fourball_type", entityId: input.id, metadata: { fields: Object.keys(changes) } });
  sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST") return await create(req, res);
    if (req.method === "PATCH") return await update(req, res);
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The fourball type request failed.");
  }
}

export const config = { maxDuration: 30 };
