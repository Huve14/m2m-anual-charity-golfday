import { adminClient, fromSupabase, recordAudit, requireAdmin, sendError, sendJson } from "../../_ops.js";

function csvCell(value) {
  const safe = String(value ?? "").replace(/\r?\n/g, " ");
  const protectedValue = /^\s*[=+\-@]/.test(safe) ? `'${safe}` : safe;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    const actor = await requireAdmin(req);
    const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
    const type = ["players", "fourballs", "sponsors", "hosts"].includes(req.query?.type) ? req.query.type : "players";
    const client = adminClient();
    let rows;
    if (type === "players") {
      const { data, error } = await client.from("m2m_players").select("position,full_name,email,phone,handicap,shirt_size,dietary_requirements,special_requirements,home_club,golf_id,fourball:m2m_fourballs(team_name,eventCompany:m2m_event_companies(company:m2m_companies(name)))").eq("event_id", eventId).order("fourball_id").order("position");
      if (error) throw fromSupabase(error);
      rows = [["Company", "Team", "Position", "Player", "Email", "Phone", "Handicap", "Shirt size", "Dietary", "Special requirements", "Home club", "Golf ID"], ...data.map((item) => [item.fourball?.eventCompany?.company?.name, item.fourball?.team_name, item.position, item.full_name, item.email, item.phone, item.handicap, item.shirt_size, item.dietary_requirements, item.special_requirements, item.home_club, item.golf_id])];
    } else if (type === "fourballs") {
      const { data, error } = await client.from("m2m_fourballs").select("team_name,booking_status,submission_status,payment_status,confirmed_amount_minor,eventCompany:m2m_event_companies(company:m2m_companies(name)),tee:m2m_tee_slots(slot_label,hole:m2m_event_holes(label)),hosts:m2m_fourball_hosts(is_primary,profile:m2m_profiles(full_name,email))").eq("event_id", eventId).order("team_name");
      if (error) throw fromSupabase(error);
      rows = [["Company", "Team", "Booking", "Submission", "Start", "Primary host", "Host email", "Amount", "Payment"], ...data.map((item) => { const host = item.hosts?.find((entry) => entry.is_primary); const tee = item.tee?.[0]; return [item.eventCompany?.company?.name, item.team_name, item.booking_status, item.submission_status, tee ? `${tee.hole?.label} ${tee.slot_label}` : "Unassigned", host?.profile?.full_name, host?.profile?.email, item.confirmed_amount_minor, item.payment_status]; })];
    } else if (type === "sponsors") {
      const { data, error } = await client.from("m2m_sponsorship_commitments").select("status,quantity,confirmed_amount_minor,payment_status,invoice_reference,type:m2m_sponsorship_types(name),eventCompany:m2m_event_companies(company:m2m_companies(name)),units:m2m_sponsorship_units(unit_number,slot:m2m_hole_sponsorship_slots(label,hole:m2m_event_holes(label)))").eq("event_id", eventId);
      if (error) throw fromSupabase(error);
      rows = [["Company", "Sponsorship", "Status", "Unit", "Hole allocation", "Amount", "Invoice", "Payment"], ...data.flatMap((item) => (item.units || []).map((unit) => [item.eventCompany?.company?.name, item.type?.name, item.status, unit.unit_number, unit.slot ? `${unit.slot.hole?.label} · ${unit.slot.label}` : "Unallocated", item.confirmed_amount_minor, item.invoice_reference, item.payment_status]))];
    } else {
      const { data, error } = await client.from("m2m_fourball_hosts").select("is_primary,invited_at,accepted_at,last_notified_at,profile:m2m_profiles(full_name,email),fourball:m2m_fourballs(team_name,submission_status,eventCompany:m2m_event_companies(company:m2m_companies(name)))").eq("event_id", eventId);
      if (error) throw fromSupabase(error);
      rows = [["Company", "Team", "Host", "Email", "Primary", "Invited", "Accepted", "Last reminder", "Submission"], ...data.map((item) => [item.fourball?.eventCompany?.company?.name, item.fourball?.team_name, item.profile?.full_name, item.profile?.email, item.is_primary ? "Yes" : "No", item.invited_at, item.accepted_at, item.last_notified_at, item.fourball?.submission_status])];
    }
    await recordAudit({ eventId, actorId: actor.id, action: "event.exported", entityType: "event", entityId: eventId, metadata: { type } });
    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="m2m-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(csv(rows));
  } catch (error) {
    sendError(res, error, "The export could not be created.");
  }
}

export const config = { maxDuration: 30 };
