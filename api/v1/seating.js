import { z } from 'zod';
import { adminClient, apiFailure, fromSupabase, sendError, sendJson, validate } from '../_ops.js';
import { loadGalaData } from '../_gala.js';
import { findSeating } from '../_seating.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw apiFailure('method_not_allowed', 'Method not allowed.', 405);
    }
    const { eventId, q } = validate(z.object({ eventId: z.string().uuid().optional(), q: z.string().trim().min(2).max(160) }), req.query || {});
    const client = adminClient();
    const events = client.from('m2m_events').select('id,name').eq('status', 'active');
    const { data, error } = await (eventId ? events.eq('id', eventId).maybeSingle() : events.limit(2));
    if (error) throw fromSupabase(error, 'seating_unavailable', 'Seating is temporarily unavailable. Please try again.');
    if (!eventId && data?.length > 1) throw apiFailure('event_required', 'Please use the event seating link shared by the organisers or ask the welcome desk.', 400);
    const event = eventId ? data : data?.[0];
    if (!event) throw apiFailure('event_unavailable', 'Seating is not available for this event. Please ask the welcome desk.', 404);
    const result = findSeating(await loadGalaData(client, event.id), q);
    return sendJson(res, 200, { ok: true, eventName: event.name, ...result });
  } catch (error) { sendError(res, error, 'Seating could not be loaded. Please try again or ask the welcome desk.'); }
}
