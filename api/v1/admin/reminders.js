import { z } from "zod";
import { parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";
import { sendHostReminder } from "../../_reminders.js";

const schema = z.object({ eventId: z.string().uuid(), fourballId: z.string().uuid(), profileId: z.string().uuid() });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
    return;
  }
  try {
    const actor = await requireAdmin(req);
    const input = validate(schema, parseJsonBody(req));
    const result = await sendHostReminder({ req, ...input, offsetLabel: `manual-${Date.now()}` });
    await recordAudit({ eventId: input.eventId, actorId: actor.id, action: "host.reminder_sent", entityType: "fourball", entityId: input.fourballId, metadata: { profileId: input.profileId, status: result.status } });
    sendJson(res, 200, { ok: true, delivery: result });
  } catch (error) {
    sendError(res, error, "The reminder could not be sent.");
  }
}

export const config = { maxDuration: 30 };

