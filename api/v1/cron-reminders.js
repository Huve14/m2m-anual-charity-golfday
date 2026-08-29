import { adminClient, apiFailure, sendError, sendJson } from "../_ops.js";
import { sendHostReminder } from "../_reminders.js";

function johannesburgDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function daysBetween(left, right) {
  const oneDay = 86_400_000;
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / oneDay);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    const secret = String(process.env.CRON_SECRET || "");
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) throw apiFailure("cron_unauthorised", "Cron authentication failed.", 401);
    const client = adminClient();
    const { data: events, error } = await client.from("m2m_events").select("id,player_deadline_at,reminder_offsets_days").eq("status", "active").not("player_deadline_at", "is", null);
    if (error) throw error;
    const today = johannesburgDate();
    const dueEvents = events.map((event) => ({ ...event, deadlineDate: johannesburgDate(new Date(event.player_deadline_at)) })).filter((event) => (event.reminder_offsets_days || []).includes(daysBetween(today, event.deadlineDate)));
    const deliveries = [];
    for (const event of dueEvents) {
      const offset = daysBetween(today, event.deadlineDate);
      const { data: assignments, error: assignmentError } = await client.from("m2m_fourball_hosts").select("fourball_id,profile_id,fourball:m2m_fourballs(submission_status,booking_status)").eq("event_id", event.id).not("invited_at", "is", null);
      if (assignmentError) throw assignmentError;
      for (const assignment of assignments.filter((item) => item.fourball?.submission_status !== "submitted" && item.fourball?.booking_status === "confirmed")) {
        const result = await sendHostReminder({ req, eventId: event.id, fourballId: assignment.fourball_id, profileId: assignment.profile_id, offsetLabel: String(offset), scheduledFor: today });
        deliveries.push(result.status);
      }
    }
    sendJson(res, 200, { ok: true, eventsChecked: events.length, remindersDue: deliveries.length, sent: deliveries.filter((status) => status === "sent").length });
  } catch (error) {
    sendError(res, error, "Scheduled reminders failed.");
  }
}

export const config = { maxDuration: 60 };

