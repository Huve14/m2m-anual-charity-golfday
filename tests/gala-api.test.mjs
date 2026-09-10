import assert from 'node:assert/strict';
import test from 'node:test';
process.env.SUPABASE_URL = 'https://gala.test';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public';
const { default: handler } = await import('../api/v1/admin/gala.js');
const eventId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const headers = { authorization: 'Bearer token', 'content-type': 'application/json' };
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, end(body) { this.body = JSON.parse(body); } }; }
function mock(t, { role = 'admin', found = true } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const table = url.pathname.split('/').at(-1);
    let payload;
    if (url.pathname === '/auth/v1/user') payload = { id };
    else if (table === 'm2m_profiles') payload = { id, role, is_active: true };
    else if (table === 'm2m_audit_events') payload = {};
    else if (table === 'm2m_cancel_gala_attendance') { calls.push({ url, body: JSON.parse(init.body) }); payload = id; }
    else { calls.push({ url, body: init.body && JSON.parse(init.body), method: init.method }); payload = init.method === 'GET' ? [] : found ? { id } : null; }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}
test('gala access rejects unauthenticated users and hosts before reading records', async t => {
  const calls = mock(t, { role: 'host' });
  for (const [h, status] of [[{}, 401], [headers, 403]]) { const res = response(); await handler({ method: 'GET', headers: h, query: { eventId } }, res); assert.equal(res.statusCode, status); }
  assert.equal(calls.length, 0);
});
test('party create saves companions together and generates individual guest IDs', async t => {
  const calls = mock(t); const res = response();
  await handler({ method: 'POST', headers, body: { action: 'saveParty', eventId, name: 'Smiths', tableName: 'Table 4', guests: [{ fullName: 'Jane Smith', dietaryRequirements: 'Vegetarian', attendance: 'confirmed' }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].body.event_id, eventId);
  assert.equal(calls[0].body.guests[0].dietaryRequirements, 'Vegetarian');
  assert.match(calls[0].body.guests[0].id, /^[0-9a-f-]{36}$/);
});
test('party updates are event scoped and report missing rows', async t => {
  const calls = mock(t, { found: false }); const res = response();
  await handler({ method: 'POST', headers, body: { action: 'saveParty', id, eventId, name: 'Smiths', tableName: '', guests: [] } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls[0].url.searchParams.get('event_id'), `eq.${eventId}`);
  assert.equal(calls[0].url.searchParams.get('id'), `eq.${id}`);
});
test('invalid event IDs and invalid quantities are rejected without database writes', async t => {
  const calls = mock(t);
  for (const req of [{ method: 'GET', query: { eventId: 'invalid' } }, { method: 'POST', body: { action: 'saveParty', eventId, name: 'Smiths', tableName: '', quantity: -1, guests: [] } }]) { const res = response(); await handler({ ...req, headers }, res); assert.equal(res.statusCode, 400); }
  assert.equal(calls.length, 0);
});

test('a party name and quantity reserves confirmed seats without guest details', async t => {
  const calls = mock(t); const res = response();
  await handler({ method: 'POST', headers, body: { action: 'saveParty', eventId, name: 'Smith family', quantity: 5 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].body.guests.length, 5);
  assert.ok(calls[0].body.guests.every(g => g.fullName === '' && g.attendance === 'confirmed'));
  assert.equal(new Set(calls[0].body.guests.map(g => g.id)).size, 5);
});
test('quantity cannot silently discard supplied guest details', async t => {
  const calls = mock(t); const res = response();
  await handler({ method: 'POST', headers, body: { action: 'saveParty', eventId, name: 'Smith family', quantity: 0, guests: [{ fullName: 'Jane' }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('individual cancellation persists the golfer override without changing golf records', async t => {
  const calls = mock(t); const res = response();
  await handler({ method: 'POST', headers, body: { action: 'savePlayer', eventId, id, partyId: null, attendance: 'declined' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.attendance, 'declined');
  assert.match(calls[0].url.pathname, /m2m_gala_players$/);
});
test('family and individual guest cancellation use an event-scoped atomic operation', async t => {
  const calls = mock(t);
  for (const guestId of [undefined, id]) {
    const res = response();
    await handler({ method: 'POST', headers, body: { action: 'cancelAttendance', eventId, partyId: id, guestId } }, res);
    assert.equal(res.statusCode, 200);
  }
  assert.deepEqual(calls.map(c => c.body), [{ p_event_id: eventId, p_party_id: id, p_guest_id: null }, { p_event_id: eventId, p_party_id: id, p_guest_id: id }]);
});
