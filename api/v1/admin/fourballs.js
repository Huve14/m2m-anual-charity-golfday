import { z } from "zod";
import { adminClient, fromSupabase, parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const createSchema = z.object({
  eventId: z.string().uuid(),
  eventCompanyId: z.string().uuid(),
  teamName: z.string().trim().min(2).max(160),
  bookingStatus: z.enum(["pending", "confirmed", "cancelled"]).default("pending"),
  confirmedAmountMinor: z.number().int().min(0).default(0),
  invoiceReference: z.string().trim().max(120).optional(),
  paymentStatus: z.enum(["unpaid", "partial", "paid", "waived"]).default("unpaid"),
  notes: z.string().trim().max(5000).optional(),
});

const playerSchema = z.object({
  id: z.string().uuid(), eventId: z.string().uuid(), fourballId: z.string().uuid(),
  fullName: z.string().trim().max(160).default(""), email: z.union([z.string().email(), z.literal("")]).default(""),
  phone: z.string().trim().max(40).default(""), handicap: z.string().trim().max(20).default(""),
  shirtSize: z.string().trim().max(20).default(""), dietaryRequirements: z.string().trim().max(1000).default(""),
  specialRequirements: z.string().trim().max(1000).default(""), homeClub: z.string().trim().max(160).default(""),
  golfId: z.string().trim().max(80).default(""),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), id: z.string().uuid(), eventId: z.string().uuid(), teamName: z.string().trim().min(2).max(160).optional(), bookingStatus: z.enum(["pending", "confirmed", "cancelled"]).optional(), confirmedAmountMinor: z.number().int().min(0).optional(), invoiceReference: z.string().trim().max(120).nullable().optional(), paymentStatus: z.enum(["unpaid", "partial", "paid", "waived"]).optional(), notes: z.string().trim().max(5000).nullable().optional() }),
  z.object({ action: z.literal("assignTee"), id: z.string().uuid(), eventId: z.string().uuid(), teeSlotId: z.string().uuid() }),
  z.object({ action: z.literal("clearTee"), id: z.string().uuid(), eventId: z.string().uuid() }),
  z.object({ action: z.literal("assignHost"), id: z.string().uuid(), eventId: z.string().uuid(), profileId: z.string().uuid(), isPrimary: z.boolean().default(false) }),
  z.object({ action: z.literal("removeHost"), id: z.string().uuid(), eventId: z.string().uuid(), profileId: z.string().uuid() }),
  z.object({ action: z.literal("reopen"), id: z.string().uuid(), eventId: z.string().uuid() }),
  z.object({ action: z.literal("savePlayer"), ...playerSchema.shape }),
]);

function shape(item) {
  const players = (item.players || []).toSorted((a, b) => a.position - b.position).map((player) => ({
    id: player.id, position: player.position, fullName: player.full_name, email: player.email, phone: player.phone,
    handicap: player.handicap, shirtSize: player.shirt_size, dietaryRequirements: player.dietary_requirements,
    specialRequirements: player.special_requirements, homeClub: player.home_club, golfId: player.golf_id,
  }));
  return {
    id: item.id, eventId: item.event_id, eventCompanyId: item.event_company_id,
    companyName: item.eventCompany?.company?.name || "", teamName: item.team_name,
    bookingStatus: item.booking_status, confirmedAmountMinor: item.confirmed_amount_minor,
    invoiceReference: item.invoice_reference || "", paymentStatus: item.payment_status,
    submissionStatus: item.submission_status, submittedAt: item.submitted_at,
    notes: item.notes || "", players,
    hosts: (item.hosts || []).map((host) => ({ id: host.id, profileId: host.profile_id, isPrimary: host.is_primary, invitedAt: host.invited_at, acceptedAt: host.accepted_at, fullName: host.profile?.full_name || "", email: host.profile?.email || "" })),
    teeSlot: item.teeSlot?.[0] ? { id: item.teeSlot[0].id, label: `${item.teeSlot[0].hole?.label || "Hole"}${item.teeSlot[0].slot_label ? ` ${item.teeSlot[0].slot_label}` : ""}` } : null,
  };
}

const SELECT = "*,players:m2m_players(*),hosts:m2m_fourball_hosts(*,profile:m2m_profiles(id,email,full_name)),eventCompany:m2m_event_companies(id,company:m2m_companies(id,name)),teeSlot:m2m_tee_slots(id,slot_label,hole:m2m_event_holes(id,label))";

async function list(req, res) {
  await requireAdmin(req);
  const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
  const client = adminClient();
  const [fourballs, teeSlots, profiles] = await Promise.all([
    client.from("m2m_fourballs").select(SELECT).eq("event_id", eventId).order("created_at"),
    client.from("m2m_tee_slots").select("id,slot_label,fourball_id,hole:m2m_event_holes(id,label,hole_number)").eq("event_id", eventId).order("sort_order"),
    client.from("m2m_profiles").select("id,email,full_name,role,is_active").eq("is_active", true).order("full_name"),
  ]);
  if (fourballs.error || teeSlots.error || profiles.error) throw fromSupabase(fourballs.error || teeSlots.error || profiles.error, "fourballs_load_failed", "Fourballs could not be loaded.");
  sendJson(res, 200, { ok: true, fourballs: fourballs.data.map(shape), teeSlots: teeSlots.data.map((slot) => ({ id: slot.id, label: `${slot.hole?.label || "Hole"} ${slot.slot_label}`, fourballId: slot.fourball_id })), profiles: profiles.data.map((p) => ({ id: p.id, email: p.email, fullName: p.full_name, role: p.role })) });
}

async function create(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(createSchema, parseJsonBody(req));
  const client = adminClient();
  const { data, error } = await client.from("m2m_fourballs").insert({
    event_id: input.eventId, event_company_id: input.eventCompanyId, team_name: input.teamName,
    booking_status: input.bookingStatus, confirmed_amount_minor: input.confirmedAmountMinor,
    invoice_reference: input.invoiceReference || null, payment_status: input.paymentStatus, notes: input.notes || null,
  }).select("id").single();
  if (error) throw fromSupabase(error, "fourball_create_failed", "The fourball could not be created.");
  const { error: playerError } = await client.from("m2m_players").insert(Array.from({ length: 4 }, (_, index) => ({ event_id: input.eventId, fourball_id: data.id, position: index + 1 })));
  if (playerError) {
    await client.from("m2m_fourballs").delete().eq("id", data.id);
    throw fromSupabase(playerError, "player_slots_create_failed", "The player positions could not be created.");
  }
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "fourball.created", entityType: "fourball", entityId: data.id });
  const { data: created, error: readError } = await client.from("m2m_fourballs").select(SELECT).eq("id", data.id).single();
  if (readError) throw fromSupabase(readError);
  sendJson(res, 201, { ok: true, fourball: shape(created) });
}

async function update(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(actionSchema, parseJsonBody(req));
  const client = adminClient();
  if (input.action === "assignTee") {
    const { error } = await client.rpc("m2m_assign_tee_slot", { p_event_id: input.eventId, p_slot_id: input.teeSlotId, p_fourball_id: input.id, p_actor_id: profile.id });
    if (error) throw fromSupabase(error, "tee_assignment_failed", "The start slot could not be assigned.");
  } else if (input.action === "clearTee") {
    const { error } = await client.from("m2m_tee_slots").update({ fourball_id: null }).eq("event_id", input.eventId).eq("fourball_id", input.id);
    if (error) throw fromSupabase(error, "tee_assignment_failed");
  } else if (input.action === "assignHost") {
    if (input.isPrimary) await client.from("m2m_fourball_hosts").update({ is_primary: false }).eq("fourball_id", input.id);
    const { error } = await client.from("m2m_fourball_hosts").upsert({ event_id: input.eventId, fourball_id: input.id, profile_id: input.profileId, is_primary: input.isPrimary }, { onConflict: "fourball_id,profile_id" });
    if (error) throw fromSupabase(error, "host_assignment_failed", "The host could not be assigned.");
    await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "host.assigned", entityType: "fourball", entityId: input.id, metadata: { profileId: input.profileId, primary: input.isPrimary } });
  } else if (input.action === "removeHost") {
    const { error } = await client.from("m2m_fourball_hosts").delete().eq("event_id", input.eventId).eq("fourball_id", input.id).eq("profile_id", input.profileId);
    if (error) throw fromSupabase(error, "host_remove_failed", "The host could not be removed.");
  } else if (input.action === "reopen") {
    const { error } = await client.rpc("m2m_reopen_fourball", { p_event_id: input.eventId, p_fourball_id: input.id, p_actor_id: profile.id });
    if (error) throw fromSupabase(error, "fourball_reopen_failed", "The fourball could not be reopened.");
  } else if (input.action === "savePlayer") {
    const { error } = await client.from("m2m_players").update({
      full_name: input.fullName, email: input.email, phone: input.phone, handicap: input.handicap,
      shirt_size: input.shirtSize, dietary_requirements: input.dietaryRequirements,
      special_requirements: input.specialRequirements, home_club: input.homeClub, golf_id: input.golfId,
    }).eq("id", input.id).eq("event_id", input.eventId).eq("fourball_id", input.fourballId);
    if (error) throw fromSupabase(error, "player_update_failed", "The player could not be saved.");
  } else {
    const changes = {};
    if (input.teamName !== undefined) changes.team_name = input.teamName;
    if (input.bookingStatus !== undefined) changes.booking_status = input.bookingStatus;
    if (input.confirmedAmountMinor !== undefined) changes.confirmed_amount_minor = input.confirmedAmountMinor;
    if (input.invoiceReference !== undefined) changes.invoice_reference = input.invoiceReference || null;
    if (input.paymentStatus !== undefined) changes.payment_status = input.paymentStatus;
    if (input.notes !== undefined) changes.notes = input.notes || null;
    const { error } = await client.from("m2m_fourballs").update(changes).eq("id", input.id).eq("event_id", input.eventId);
    if (error) throw fromSupabase(error, "fourball_update_failed", "The fourball could not be updated.");
    await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "fourball.updated", entityType: "fourball", entityId: input.id, metadata: { fields: Object.keys(changes) } });
  }
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
    sendError(res, error, "The fourball request failed.");
  }
}

export const config = { maxDuration: 30 };

