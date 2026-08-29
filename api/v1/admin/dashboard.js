import { adminClient, fromSupabase, requireAdmin, sendError, sendJson } from "../../_ops.js";

function incompletePlayers(players, required) {
  return players.filter((player) => required.some((field) => !String(player[field] || "").trim())).length;
}

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
    const [eventResult, companyResult, typeResult, commitmentResult, unitResult, fourballResult, teeResult, hostResult, holeResult] = await Promise.all([
      client.from("m2m_events").select("*").eq("id", eventId).single(),
      client.from("m2m_event_companies").select("id,relationship_status").eq("event_id", eventId),
      client.from("m2m_sponsorship_types").select("id,name,capacity,requires_hole,is_active").eq("event_id", eventId),
      client.from("m2m_sponsorship_commitments").select("id,sponsorship_type_id,status,quantity").eq("event_id", eventId),
      client.from("m2m_sponsorship_units").select("id,commitment_id,hole_slot_id").eq("event_id", eventId),
      client.from("m2m_fourballs").select("id,booking_status,submission_status,players:m2m_players(*)").eq("event_id", eventId),
      client.from("m2m_tee_slots").select("id,fourball_id").eq("event_id", eventId),
      client.from("m2m_fourball_hosts").select("id,fourball_id,invited_at,accepted_at").eq("event_id", eventId),
      client.from("m2m_event_holes").select("id").eq("event_id", eventId),
    ]);
    const failed = [eventResult, companyResult, typeResult, commitmentResult, unitResult, fourballResult, teeResult, hostResult, holeResult].find((result) => result.error);
    if (failed) throw fromSupabase(failed.error, "dashboard_load_failed", "The event overview could not be loaded.");
    const event = eventResult.data;
    const commitments = commitmentResult.data || [];
    const units = unitResult.data || [];
    const activeCommitments = commitments.filter((item) => ["reserved", "confirmed"].includes(item.status));
    const confirmedCommitmentIds = new Set(commitments.filter((item) => item.status === "confirmed").map((item) => item.id));
    const confirmedUnits = units.filter((unit) => confirmedCommitmentIds.has(unit.commitment_id));
    const fourballs = fourballResult.data || [];
    const confirmedFourballs = fourballs.filter((item) => item.booking_status === "confirmed");
    const required = Array.isArray(event.required_player_fields) ? event.required_player_fields : [];
    const totalRequired = confirmedFourballs.length * 4 * required.length;
    let filledRequired = 0;
    let incompleteFourballs = 0;
    for (const fourball of confirmedFourballs) {
      const players = fourball.players || [];
      const missing = players.length !== 4 || incompletePlayers(players, required) > 0;
      if (missing) incompleteFourballs += 1;
      for (const player of players) {
        filledRequired += required.filter((field) => String(player[field] || "").trim()).length;
      }
    }
    const hostAssignments = hostResult.data || [];
    const submittedIds = new Set(fourballs.filter((item) => item.submission_status === "submitted").map((item) => item.id));
    const outstandingHosts = hostAssignments.filter((item) => !submittedIds.has(item.fourball_id)).length;
    const overdue = Boolean(event.player_deadline_at && new Date(event.player_deadline_at) < new Date());
    const blockers = [];
    if (!event.venue_name) blockers.push("Venue");
    if (!event.shotgun_start_at) blockers.push("Shotgun start");
    if (!event.registration_deadline_at) blockers.push("Registration deadline");
    if (!event.player_deadline_at) blockers.push("Player deadline");
    if (!event.rules) blockers.push("Rules");
    if ((holeResult.data || []).length === 0) blockers.push("Course holes");
    if ((teeResult.data || []).length === 0) blockers.push("Tee slots");
    const warnings = [];
    if (!event.logo_path) warnings.push("Event logo");
    if (!event.banner_path) warnings.push("Event banner");
    if ((typeResult.data || []).length === 0) warnings.push("Sponsorship inventory");
    sendJson(res, 200, {
      ok: true,
      metrics: {
        confirmedCompanies: companyResult.data.filter((item) => item.relationship_status === "confirmed").length,
        sponsorshipCapacity: typeResult.data.filter((item) => item.is_active).reduce((sum, item) => sum + item.capacity, 0),
        sponsorshipReservedOrConfirmed: activeCommitments.reduce((sum, item) => sum + item.quantity, 0),
        reservedSponsorUnits: commitments.filter((item) => item.status === "reserved").reduce((sum, item) => sum + item.quantity, 0),
        confirmedSponsorUnits: confirmedUnits.length,
        allocatedSponsorUnits: confirmedUnits.filter((item) => item.hole_slot_id).length,
        unallocatedSponsorUnits: confirmedUnits.filter((item) => !item.hole_slot_id).length,
        totalFourballs: fourballs.filter((item) => item.booking_status !== "cancelled").length,
        confirmedFourballs: confirmedFourballs.length,
        incompleteFourballs,
        completeFourballs: confirmedFourballs.length - incompleteFourballs,
        filledRequiredPlayerFields: filledRequired,
        totalRequiredPlayerFields: totalRequired,
        playerCompletionPercent: totalRequired === 0 ? 0 : Math.round((filledRequired / totalRequired) * 100),
        invitedHosts: hostAssignments.filter((item) => item.invited_at).length,
        acceptedHosts: hostAssignments.filter((item) => item.accepted_at).length,
        outstandingHosts,
        submittedHosts: hostAssignments.filter((item) => submittedIds.has(item.fourball_id)).length,
        overdueHosts: overdue ? outstandingHosts : 0,
        unassignedFourballs: confirmedFourballs.filter((fourball) => !(teeResult.data || []).some((slot) => slot.fourball_id === fourball.id)).length,
        openTeeSlots: teeResult.data.filter((slot) => !slot.fourball_id).length,
      },
      setup: { blockers, warnings, readyToActivate: blockers.length === 0 },
    });
  } catch (error) {
    sendError(res, error, "The event overview could not be loaded.");
  }
}

export const config = { maxDuration: 30 };
