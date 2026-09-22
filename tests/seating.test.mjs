import assert from 'node:assert/strict';
import test from 'node:test';
import { findSeating } from '../api/_seating.js';
process.env.SUPABASE_URL = 'https://seating.test';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
const { default: handler } = await import('../api/v1/seating.js');
const eventId = '11111111-1111-4111-8111-111111111111';
const guest = { id: 'guest', fullName: 'José Smith', email: 'private@example.com', phone: 'private', dietaryRequirements: 'private', attendance: 'confirmed' };
const party = { id: 'party', name: 'Smith family', table_name: 'Table 4', guests: [guest] };
const data = { parties: [party], players: [], settings: [] };
function response() { return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } }; }
test('search accepts accents, reordered words and groups but returns only public seating fields', () => {
  const expected = [{ name: 'José Smith', party: 'Smith family', company: '', team: '', table: 'Table 4' }];
  assert.deepEqual(findSeating(data, 'smith jose').matches, expected);
  assert.deepEqual(findSeating(data, 'family').matches, expected);
  assert.deepEqual(findSeating(data, 'private').matches, []);
  assert.deepEqual(findSeating(data, '!!').matches, []);
});
test('cancelled and pending guests are excluded; unassigned confirmed guests remain findable', () => {
  const result = findSeating({ parties: [{ ...party, table_name: '', guests: [guest, { ...guest, attendance: 'declined' }, { ...guest, attendance: 'pending' }] }] }, 'Smith');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].table, '');
});
test('large results are bounded and request a narrower search', () => {
  const result = findSeating({ parties: [{ ...party, guests: Array.from({ length: 40 }, () => guest) }] }, 'Smith');
  assert.equal(result.matches.length, 30);
  assert.equal(result.more, true);
});
test('public endpoint scopes every read to an active event and strips private guest fields', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    const table = url.pathname.split('/').at(-1);
    if (table === 'm2m_events') {
      assert.equal(url.searchParams.get('id'), `eq.${eventId}`);
      assert.equal(url.searchParams.get('status'), 'eq.active');
    } else assert.equal(url.searchParams.get('event_id'), `eq.${eventId}`);
    return new Response(JSON.stringify(table === 'm2m_events' ? { id: eventId, name: 'Gala' } : table === 'm2m_gala_parties' ? [party] : []), { headers: { 'content-type': 'application/json' } });
  });
  const res = response();
  await handler({ method: 'GET', query: { eventId, q: 'Smith' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.matches[0].table, 'Table 4');
  assert.ok(!JSON.stringify(res.body).includes('private'));
  assert.match(res.headers['Cache-Control'], /no-store/);
});
test('invalid searches, writes and unavailable events do not load guest records', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('null', { headers: { 'content-type': 'application/json' } }); });
  for (const [method, query, status] of [['POST', { eventId, q: 'Smith' }, 405], ['GET', { eventId, q: 'x' }, 400], ['GET', { eventId: 'invalid', q: 'Smith' }, 400], ['GET', { eventId, q: 'Smith' }, 404]]) {
    const res = response(); await handler({ method, query }, res); assert.equal(res.statusCode, status);
  }
  assert.equal(calls, 1);
});

test('the short gala link resolves the only active event without an event parameter', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input instanceof Request ? input.url : input);
    const table = url.pathname.split('/').at(-1);
    if (table === 'm2m_events') {
      assert.equal(url.searchParams.get('status'), 'eq.active');
      assert.equal(url.searchParams.get('limit'), '2');
    } else assert.equal(url.searchParams.get('event_id'), `eq.${eventId}`);
    return new Response(JSON.stringify(table === 'm2m_events' ? [{ id: eventId, name: 'Gala' }] : table === 'm2m_gala_parties' ? [party] : []), { headers: { 'content-type': 'application/json' } });
  });
  const res = response();
  await handler({ method: 'GET', query: { q: 'Smith' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.matches[0].table, 'Table 4');
});

test('the short gala link does not guess between multiple active events', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify([{ id: eventId }, { id: 'other' }]), { headers: { 'content-type': 'application/json' } });
  });
  const res = response();
  await handler({ method: 'GET', query: { q: 'Smith' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'event_required');
  assert.equal(calls, 1);
});
