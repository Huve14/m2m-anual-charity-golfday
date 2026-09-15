import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const event = '10000000-0000-4000-8000-000000000001';
const team = '20000000-0000-4000-8000-000000000001';
const replacement = '20000000-0000-4000-8000-000000000002';
const slot = '30000000-0000-4000-8000-000000000001';
const otherSlot = '30000000-0000-4000-8000-000000000002';

test('cancelled fourballs release tee slots and occupied starts remain protected', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table m2m_fourballs(id uuid primary key, event_id uuid, booking_status text);
    create table m2m_tee_slots(id uuid primary key, event_id uuid, fourball_id uuid unique);
    create table m2m_audit_events(event_id uuid, actor_profile_id uuid, action text, entity_type text, entity_id text, metadata jsonb);
    insert into m2m_fourballs values ('${team}', '${event}', 'cancelled'), ('${replacement}', '${event}', 'confirmed');
    insert into m2m_tee_slots values ('${slot}', '${event}', '${team}'), ('${otherSlot}', '${event}', '${replacement}');
  `);
  const original = await readFile('supabase/migrations/20260829053332_create_multi_event_golf_management.sql', 'utf8');
  await db.exec(original.slice(original.indexOf('create or replace function public.m2m_assign_tee_slot('), original.indexOf('create or replace function public.m2m_allocate_sponsorship_unit(')));
  const occupant = async id => (await db.query('select fourball_id from m2m_tee_slots where id=$1', [id])).rows[0].fourball_id;
  await assert.rejects(db.query('select m2m_assign_tee_slot($1,$2,$3,null)', [event, slot, replacement]), /m2m_tee_slot_already_assigned/);
  await db.exec(await readFile('supabase/migrations/20260915142916_release_cancelled_fourball_tee_slots.sql', 'utf8'));
  assert.equal(await occupant(slot), null, 'historical cancelled reservation is repaired');
  assert.equal(await occupant(otherSlot), replacement, 'confirmed reservation is preserved');
  await db.query('select m2m_assign_tee_slot($1,$2,$3,null)', [event, slot, replacement]);
  assert.equal(await occupant(slot), replacement);
  assert.equal(await occupant(otherSlot), null, 'moving a team clears the previous slot');
  await db.exec(`update m2m_fourballs set booking_status='confirmed' where id='${team}'`);
  await db.query('select m2m_assign_tee_slot($1,$2,$3,null)', [event, otherSlot, team]);
  await assert.rejects(db.query('select m2m_assign_tee_slot($1,$2,$3,null)', [event, slot, team]), /m2m_tee_slot_already_assigned/);
  assert.equal(await occupant(otherSlot), team, 'failed move preserves the previous slot');
  await db.exec(`update m2m_fourballs set booking_status='cancelled' where id='${replacement}'`);
  assert.equal(await occupant(slot), null, 'new cancellation releases the slot immediately');
  await assert.rejects(db.query('select m2m_assign_tee_slot($1,$2,$3,null)', [event, slot, replacement]), /m2m_fourball_must_be_confirmed/);
  await db.query('select m2m_assign_tee_slot($1,$2,$3,null)', [event, slot, team]);
  assert.equal(await occupant(slot), team, 'released position can be assigned again');
});
