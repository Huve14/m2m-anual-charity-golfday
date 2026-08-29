import { z } from "zod";
import { adminClient, fromSupabase, parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createType"), eventId: z.string().uuid(), name: z.string().trim().min(2).max(160), category: z.enum(["alcoholic_hole", "non_alcoholic_hole", "branded_hole", "other"]), capacity: z.number().int().min(0).max(999), priceMinor: z.number().int().min(0), requiresHole: z.boolean(), isActive: z.boolean().default(true) }),
  z.object({ action: z.literal("updateType"), eventId: z.string().uuid(), id: z.string().uuid(), name: z.string().trim().min(2).max(160).optional(), category: z.enum(["alcoholic_hole", "non_alcoholic_hole", "branded_hole", "other"]).optional(), capacity: z.number().int().min(0).max(999).optional(), priceMinor: z.number().int().min(0).optional(), requiresHole: z.boolean().optional(), isActive: z.boolean().optional() }),
  z.object({ action: z.literal("createCommitment"), eventId: z.string().uuid(), eventCompanyId: z.string().uuid(), sponsorshipTypeId: z.string().uuid(), status: z.enum(["draft", "reserved", "confirmed", "cancelled"]), quantity: z.number().int().min(1).max(99), confirmedAmountMinor: z.number().int().min(0), invoiceReference: z.string().trim().max(120).optional(), paymentStatus: z.enum(["unpaid", "partial", "paid", "waived"]), notes: z.string().trim().max(5000).optional() }),
  z.object({ action: z.literal("updateCommitment"), eventId: z.string().uuid(), id: z.string().uuid(), status: z.enum(["draft", "reserved", "confirmed", "cancelled"]).optional(), quantity: z.number().int().min(1).max(99).optional(), confirmedAmountMinor: z.number().int().min(0).optional(), invoiceReference: z.string().trim().max(120).nullable().optional(), paymentStatus: z.enum(["unpaid", "partial", "paid", "waived"]).optional(), notes: z.string().trim().max(5000).nullable().optional() }),
  z.object({ action: z.literal("createHoleSlot"), eventId: z.string().uuid(), holeId: z.string().uuid(), label: z.string().trim().min(1).max(120), sponsorshipTypeId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("allocate"), eventId: z.string().uuid(), unitId: z.string().uuid(), holeSlotId: z.string().uuid() }),
  z.object({ action: z.literal("unallocate"), eventId: z.string().uuid(), unitId: z.string().uuid() }),
]);

async function list(req, res) {
  await requireAdmin(req);
  const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
  const client = adminClient();
  const [types, commitments, slots, companies] = await Promise.all([
    client.from("m2m_sponsorship_types").select("*").eq("event_id", eventId).order("sort_order"),
    client.from("m2m_sponsorship_commitments").select("*,type:m2m_sponsorship_types(id,name,requires_hole,category),eventCompany:m2m_event_companies(id,company:m2m_companies(id,name)),units:m2m_sponsorship_units(*)").eq("event_id", eventId).order("created_at"),
    client.from("m2m_hole_sponsorship_slots").select("*,hole:m2m_event_holes(id,label,hole_number),type:m2m_sponsorship_types(id,name),unit:m2m_sponsorship_units(id,commitment_id)").eq("event_id", eventId).order("sort_order"),
    client.from("m2m_event_companies").select("id,company:m2m_companies(id,name)").eq("event_id", eventId),
  ]);
  if (types.error || commitments.error || slots.error || companies.error) throw fromSupabase(types.error || commitments.error || slots.error || companies.error, "sponsorships_load_failed", "Sponsorships could not be loaded.");
  sendJson(res, 200, {
    ok: true,
    types: types.data.map((item) => ({ id: item.id, name: item.name, category: item.category, capacity: item.capacity, priceMinor: item.price_minor, requiresHole: item.requires_hole, isActive: item.is_active })),
    commitments: commitments.data.map((item) => ({
      id: item.id, eventCompanyId: item.event_company_id, companyName: item.eventCompany?.company?.name || "",
      sponsorshipTypeId: item.sponsorship_type_id, typeName: item.type?.name || "", category: item.type?.category || "other",
      requiresHole: Boolean(item.type?.requires_hole), status: item.status, quantity: item.quantity,
      confirmedAmountMinor: item.confirmed_amount_minor, invoiceReference: item.invoice_reference || "",
      paymentStatus: item.payment_status, notes: item.notes || "",
      units: (item.units || []).toSorted((a, b) => a.unit_number - b.unit_number).map((unit) => ({ id: unit.id, unitNumber: unit.unit_number, holeSlotId: unit.hole_slot_id, allocatedAt: unit.allocated_at })),
    })),
    holeSlots: slots.data.map((item) => ({ id: item.id, holeId: item.hole_id, label: item.label, displayLabel: `${item.hole?.label || "Hole"} · ${item.label}`, sponsorshipTypeId: item.sponsorship_type_id, typeName: item.type?.name || "Any hole sponsorship", unitId: item.unit?.[0]?.id || null })),
    companies: companies.data.map((item) => ({ id: item.id, name: item.company?.name || "" })),
  });
}

async function mutate(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(actionSchema, parseJsonBody(req));
  const client = adminClient();
  let entityId = input.id || input.unitId || "new";
  if (input.action === "createType") {
    const { data, error } = await client.from("m2m_sponsorship_types").insert({ event_id: input.eventId, name: input.name, category: input.category, capacity: input.capacity, price_minor: input.priceMinor, requires_hole: input.requiresHole, is_active: input.isActive }).select("id").single();
    if (error) throw fromSupabase(error, "sponsorship_type_create_failed", "The sponsorship type could not be created.");
    entityId = data.id;
  } else if (input.action === "updateType") {
    const changes = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.category !== undefined) changes.category = input.category;
    if (input.capacity !== undefined) changes.capacity = input.capacity;
    if (input.priceMinor !== undefined) changes.price_minor = input.priceMinor;
    if (input.requiresHole !== undefined) changes.requires_hole = input.requiresHole;
    if (input.isActive !== undefined) changes.is_active = input.isActive;
    const { error } = await client.from("m2m_sponsorship_types").update(changes).eq("id", input.id).eq("event_id", input.eventId);
    if (error) throw fromSupabase(error, "sponsorship_type_update_failed", "The sponsorship type could not be updated.");
  } else if (input.action === "createCommitment") {
    const { data, error } = await client.from("m2m_sponsorship_commitments").insert({ event_id: input.eventId, event_company_id: input.eventCompanyId, sponsorship_type_id: input.sponsorshipTypeId, status: input.status, quantity: input.quantity, confirmed_amount_minor: input.confirmedAmountMinor, invoice_reference: input.invoiceReference || null, payment_status: input.paymentStatus, notes: input.notes || null }).select("id").single();
    if (error) throw fromSupabase(error, "sponsorship_create_failed", "The sponsorship could not be created.");
    entityId = data.id;
  } else if (input.action === "updateCommitment") {
    const changes = {};
    if (input.status !== undefined) changes.status = input.status;
    if (input.quantity !== undefined) changes.quantity = input.quantity;
    if (input.confirmedAmountMinor !== undefined) changes.confirmed_amount_minor = input.confirmedAmountMinor;
    if (input.invoiceReference !== undefined) changes.invoice_reference = input.invoiceReference || null;
    if (input.paymentStatus !== undefined) changes.payment_status = input.paymentStatus;
    if (input.notes !== undefined) changes.notes = input.notes || null;
    const { error } = await client.from("m2m_sponsorship_commitments").update(changes).eq("id", input.id).eq("event_id", input.eventId);
    if (error) throw fromSupabase(error, "sponsorship_update_failed", "The sponsorship could not be updated.");
  } else if (input.action === "createHoleSlot") {
    const { data, error } = await client.from("m2m_hole_sponsorship_slots").insert({ event_id: input.eventId, hole_id: input.holeId, label: input.label, sponsorship_type_id: input.sponsorshipTypeId || null }).select("id").single();
    if (error) throw fromSupabase(error, "hole_slot_create_failed", "The hole slot could not be created.");
    entityId = data.id;
  } else if (input.action === "allocate") {
    const { error } = await client.rpc("m2m_allocate_sponsorship_unit", { p_event_id: input.eventId, p_unit_id: input.unitId, p_hole_slot_id: input.holeSlotId, p_actor_id: profile.id });
    if (error) throw fromSupabase(error, "sponsorship_allocate_failed", "The sponsorship could not be allocated.");
  } else if (input.action === "unallocate") {
    const { error } = await client.from("m2m_sponsorship_units").update({ hole_slot_id: null, allocated_at: null, allocated_by: null }).eq("id", input.unitId).eq("event_id", input.eventId);
    if (error) throw fromSupabase(error, "sponsorship_unallocate_failed", "The sponsorship allocation could not be removed.");
  }
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: `sponsorship.${input.action}`, entityType: "sponsorship", entityId, metadata: {} });
  sendJson(res, 200, { ok: true, id: entityId });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST" || req.method === "PATCH") return await mutate(req, res);
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The sponsorship request failed.");
  }
}

export const config = { maxDuration: 30 };

