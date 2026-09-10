import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminClient, apiFailure, fromSupabase, parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from '../../_ops.js';
import { galaAttendees, loadGalaData } from '../../_gala.js';

const attendance = z.enum(['pending', 'confirmed', 'declined']);
const guest = z.object({ id: z.string().uuid().optional(), fullName: z.string().trim().max(160).default(''), email: z.union([z.string().email(), z.literal('')]).default(''), phone: z.string().trim().max(40).default(''), dietaryRequirements: z.string().trim().max(1000).default(''), attendance: attendance.default('confirmed') });
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancelAttendance'), eventId: z.string().uuid(), partyId: z.string().uuid(), guestId: z.string().uuid().optional() }),
  z.object({ action: z.literal('saveParty'), eventId: z.string().uuid(), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(160), tableName: z.string().trim().max(80).default(''), quantity: z.number().int().min(0).max(100).optional(), guests: z.array(guest).max(100).default([]) }),
  z.object({ action: z.literal('savePlayer'), eventId: z.string().uuid(), id: z.string().uuid(), partyId: z.string().uuid().nullable(), attendance }),
]);

export default async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return sendJson(res, 405, { ok: false, message: 'Method not allowed.' }); }
    const actor = await requireAdmin(req);
    const client = adminClient();
    if (req.method === 'GET') {
      const { eventId } = validate(z.object({ eventId: z.string().uuid() }), req.query);
      const data = await loadGalaData(client, eventId);
      return sendJson(res, 200, { ok: true, parties: data.parties, attendees: galaAttendees(data) });
    }
    const input = validate(schema, parseJsonBody(req));
    let result;
    if (input.action === 'cancelAttendance') {
      const cancelled = await client.rpc('m2m_cancel_gala_attendance', { p_event_id: input.eventId, p_party_id: input.partyId, p_guest_id: input.guestId || null });
      result = { error: cancelled.error, data: cancelled.data ? { id: cancelled.data } : null };
    } else if (input.action === 'saveParty') {
      const quantity = input.quantity ?? input.guests.length;
      if (quantity < input.guests.length) throw apiFailure('invalid_quantity', 'Quantity cannot be less than the guest records supplied.', 400);
      const guests = Array.from({ length: quantity }, (_, index) => input.guests[index] || { fullName: '', email: '', phone: '', dietaryRequirements: '', attendance: 'confirmed' });
      const row = { event_id: input.eventId, name: input.name, table_name: input.tableName, guests: guests.map(g => ({ ...g, id: g.id || randomUUID() })) };
      result = input.id
        ? await client.from('m2m_gala_parties').update(row).eq('id', input.id).eq('event_id', input.eventId).select('id').maybeSingle()
        : await client.from('m2m_gala_parties').insert(row).select('id').single();
    } else {
      // Composite foreign keys prevent linking a player or party from another event.
      result = await client.from('m2m_gala_players').upsert({ id: input.id, event_id: input.eventId, party_id: input.partyId, attendance: input.attendance === 'declined' ? 'declined' : 'confirmed' }).select('id').single();
    }
    if (result.error) throw fromSupabase(result.error, 'gala_save_failed', 'The dinner details could not be saved. Check the player and party belong to this event.');
    if (!result.data) throw apiFailure('not_found', 'This dinner party no longer exists.', 404);
    await recordAudit({ eventId: input.eventId, actorId: actor.id, action: `gala.${input.action}`, entityType: 'gala', entityId: result.data.id, metadata: input.action === 'cancelAttendance' ? { guestId: input.guestId || null } : {} });
    sendJson(res, 200, { ok: true });
  } catch (error) { sendError(res, error, 'The gala dinner request failed.'); }
}
