import { z } from "zod";
import {
  adminClient, apiFailure, fromSupabase, parseJsonBody, recordAudit, requireHostAssignment,
  requireProfile, sendError, sendJson, validate,
} from "../../_ops.js";

const playerInput = z.object({
  action: z.literal("savePlayer"), eventId: z.string().uuid(), fourballId: z.string().uuid(), playerId: z.string().uuid(),
  fullName: z.string().trim().max(160), email: z.union([z.string().email(), z.literal("")]),
  phone: z.string().trim().max(40), handicap: z.string().trim().max(20), shirtSize: z.string().trim().max(20),
  dietaryRequirements: z.string().trim().max(1000), specialRequirements: z.string().trim().max(1000),
  homeClub: z.string().trim().max(160), golfId: z.string().trim().max(80),
});
const actionSchema = z.discriminatedUnion("action", [
  playerInput,
  z.object({ action: z.literal("saveCustom"), eventId: z.string().uuid(), fourballId: z.string().uuid(), playerId: z.string().uuid(), fieldId: z.string().uuid(), value: z.unknown() }),
  z.object({ action: z.literal("submit"), eventId: z.string().uuid(), fourballId: z.string().uuid(), consent: z.literal(true), consentVersion: z.string().trim().min(3).max(80) }),
  z.object({ action: z.literal("accept"), eventId: z.string().uuid(), fourballId: z.string().uuid() }),
]);

function publicFourball(item, event, customFields = []) {
  const required = Array.isArray(event.required_player_fields) ? event.required_player_fields : [];
  const players = (item.players || []).toSorted((a, b) => a.position - b.position).map((player) => {
    const data = {
      id: player.id, position: player.position, fullName: player.full_name, email: player.email, phone: player.phone,
      handicap: player.handicap, shirtSize: player.shirt_size, dietaryRequirements: player.dietary_requirements,
      specialRequirements: player.special_requirements, homeClub: player.home_club, golfId: player.golf_id,
      responses: (player.responses || []).map((response) => ({ fieldId: response.field_id, value: response.value })),
    };
    const snake = { full_name: data.fullName, email: data.email, phone: data.phone, handicap: data.handicap, shirt_size: data.shirtSize, dietary_requirements: data.dietaryRequirements, special_requirements: data.specialRequirements, home_club: data.homeClub, golf_id: data.golfId };
    const customComplete = customFields.filter((field) => field.is_required).every((field) => {
      const response = data.responses.find((item) => item.fieldId === field.id);
      return response && response.value !== null && response.value !== "";
    });
    return { ...data, complete: required.every((field) => String(snake[field] || "").trim()) && customComplete };
  });
  const deadlinePassed = Boolean(event.player_deadline_at && new Date(event.player_deadline_at) < new Date());
  return {
    id: item.id, teamName: item.team_name, companyName: item.eventCompany?.company?.name || "",
    bookingStatus: item.booking_status, submissionStatus: item.submission_status, submittedAt: item.submitted_at,
    teeLabel: item.teeSlot?.[0] ? `${item.teeSlot[0].hole?.label || "Hole"} ${item.teeSlot[0].slot_label}` : "To be allocated",
    players, complete: players.length === 4 && players.every((player) => player.complete),
    locked: item.submission_status === "submitted" || deadlinePassed, deadlinePassed,
  };
}

async function list(req, res) {
  const profile = await requireProfile(req, ["host", "admin", "super_admin"]);
  const client = adminClient();
  let assignmentQuery = client.from("m2m_fourball_hosts").select("event_id,fourball_id,is_primary,invited_at,accepted_at").eq("profile_id", profile.id);
  const requestedEvent = typeof req.query?.eventId === "string" ? req.query.eventId : "";
  if (requestedEvent) assignmentQuery = assignmentQuery.eq("event_id", requestedEvent);
  const { data: assignments, error: assignmentError } = await assignmentQuery;
  if (assignmentError) throw fromSupabase(assignmentError, "assignments_load_failed", "Your fourballs could not be loaded.");
  const eventIds = [...new Set(assignments.map((item) => item.event_id))];
  const fourballIds = assignments.map((item) => item.fourball_id);
  if (eventIds.length === 0) {
    sendJson(res, 200, { ok: true, profile: { id: profile.id, fullName: profile.full_name, email: profile.email }, events: [] });
    return;
  }
  const [eventsResult, fourballsResult, fieldsResult] = await Promise.all([
    client.from("m2m_events").select("id,name,slug,status,venue_name,venue_address,format,timezone,shotgun_start_at,player_deadline_at,rules,primary_colour,accent_colour,logo_path,banner_path,required_player_fields,shirt_size_options,privacy_notice_version").in("id", eventIds),
    client.from("m2m_fourballs").select("*,players:m2m_players(*,responses:m2m_player_field_responses(field_id,value)),eventCompany:m2m_event_companies(id,company:m2m_companies(id,name)),teeSlot:m2m_tee_slots(id,slot_label,hole:m2m_event_holes(id,label))").in("id", fourballIds),
    client.from("m2m_event_player_fields").select("id,event_id,field_key,label,field_type,options,is_required,sort_order").in("event_id", eventIds).order("sort_order"),
  ]);
  if (eventsResult.error || fourballsResult.error || fieldsResult.error) throw fromSupabase(eventsResult.error || fourballsResult.error || fieldsResult.error, "host_portal_load_failed", "The host portal could not be loaded.");
  const fourballMap = new Map(fourballsResult.data.map((item) => [item.id, item]));
  const events = eventsResult.data.map((event) => {
    const eventFields = fieldsResult.data.filter((field) => field.event_id === event.id);
    return {
    id: event.id, name: event.name, status: event.status, venueName: event.venue_name, venueAddress: event.venue_address,
    format: event.format, timezone: event.timezone, shotgunStartAt: event.shotgun_start_at,
    playerDeadlineAt: event.player_deadline_at, rules: event.rules, primaryColour: event.primary_colour,
    accentColour: event.accent_colour, logoPath: event.logo_path, bannerPath: event.banner_path,
    requiredPlayerFields: event.required_player_fields || [], shirtSizeOptions: event.shirt_size_options || [], privacyNoticeVersion: event.privacy_notice_version,
    customFields: eventFields.map((field) => ({ id: field.id, key: field.field_key, label: field.label, type: field.field_type, options: field.options || [], required: field.is_required })),
    fourballs: assignments.filter((assignment) => assignment.event_id === event.id).map((assignment) => ({
      ...publicFourball(fourballMap.get(assignment.fourball_id), event, eventFields), isPrimaryHost: assignment.is_primary,
      invitedAt: assignment.invited_at, acceptedAt: assignment.accepted_at,
    })),
    };
  });
  sendJson(res, 200, { ok: true, profile: { id: profile.id, fullName: profile.full_name, email: profile.email }, events });
}

async function ensureEditable(profile, eventId, fourballId) {
  await requireHostAssignment(profile.id, eventId, fourballId);
  const { data, error } = await adminClient().from("m2m_fourballs").select("submission_status,event:m2m_events(player_deadline_at,privacy_notice_version)").eq("id", fourballId).eq("event_id", eventId).single();
  if (error) throw fromSupabase(error, "fourball_load_failed");
  if (data.submission_status === "submitted") throw apiFailure("fourball_locked", "This fourball has already been submitted.", 409);
  if (data.event?.player_deadline_at && new Date(data.event.player_deadline_at) < new Date()) throw apiFailure("deadline_passed", "The player-information deadline has passed.", 409);
  return data;
}

async function mutate(req, res) {
  const profile = await requireProfile(req, ["host", "admin", "super_admin"]);
  const input = validate(actionSchema, parseJsonBody(req));
  await requireHostAssignment(profile.id, input.eventId, input.fourballId);
  const client = adminClient();
  if (input.action === "accept") {
    const { error } = await client.from("m2m_fourball_hosts").update({ accepted_at: new Date().toISOString() }).eq("profile_id", profile.id).eq("event_id", input.eventId).eq("fourball_id", input.fourballId);
    if (error) throw fromSupabase(error, "host_accept_failed");
  } else if (input.action === "submit") {
    const editable = await ensureEditable(profile, input.eventId, input.fourballId);
    if (input.consentVersion !== editable.event?.privacy_notice_version) throw apiFailure("privacy_notice_updated", "Review the current privacy notice before submitting.", 409);
    const { error } = await client.rpc("m2m_submit_fourball", { p_event_id: input.eventId, p_fourball_id: input.fourballId, p_actor_id: profile.id, p_consent_version: input.consentVersion });
    if (error) throw fromSupabase(error, "fourball_submit_failed", "The fourball could not be submitted.");
  } else if (input.action === "savePlayer") {
    await ensureEditable(profile, input.eventId, input.fourballId);
    const { error } = await client.from("m2m_players").update({ full_name: input.fullName, email: input.email, phone: input.phone, handicap: input.handicap, shirt_size: input.shirtSize, dietary_requirements: input.dietaryRequirements, special_requirements: input.specialRequirements, home_club: input.homeClub, golf_id: input.golfId }).eq("id", input.playerId).eq("event_id", input.eventId).eq("fourball_id", input.fourballId);
    if (error) throw fromSupabase(error, "player_update_failed", "The player could not be saved.");
  } else if (input.action === "saveCustom") {
    await ensureEditable(profile, input.eventId, input.fourballId);
    const { data: player, error: playerError } = await client.from("m2m_players").select("id").eq("id", input.playerId).eq("event_id", input.eventId).eq("fourball_id", input.fourballId).maybeSingle();
    if (playerError || !player) throw apiFailure("player_not_found", "That player record is unavailable.", 404);
    const { data: field, error: fieldError } = await client.from("m2m_event_player_fields").select("id").eq("id", input.fieldId).eq("event_id", input.eventId).maybeSingle();
    if (fieldError || !field) throw apiFailure("field_not_found", "That event question is unavailable.", 404);
    const { error } = await client.from("m2m_player_field_responses").upsert({ player_id: input.playerId, event_id: input.eventId, field_id: input.fieldId, value: input.value }, { onConflict: "player_id,field_id" });
    if (error) throw fromSupabase(error, "custom_field_update_failed", "The answer could not be saved.");
  }
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: `host.${input.action}`, entityType: "fourball", entityId: input.fourballId });
  sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST" || req.method === "PATCH") return await mutate(req, res);
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The host request failed.");
  }
}

export const config = { maxDuration: 30 };
