import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://sponsorship.test';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public';
const { default: handler } = await import('../api/v1/admin/sponsorships.js');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
}

test('sponsorship directory returns numeric holes and stable company/allocation links, including empty holes', async (t) => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requested.push(url);
    let body;
    if (url.pathname === '/auth/v1/user') body = { id: 'admin' };
    else if (url.pathname.endsWith('/m2m_profiles')) body = { id: 'admin', role: 'admin', is_active: true };
    else if (url.pathname.endsWith('/m2m_sponsorship_types')) body = [{ id: 'type', name: 'Hole sponsor', requires_hole: true }];
    else if (url.pathname.endsWith('/m2m_sponsorship_commitments')) body = [{ id: 'booking', event_company_id: 'company-event', sponsorship_type_id: 'type', status: 'confirmed', quantity: 1, type: { name: 'Hole sponsor', requires_hole: true }, eventCompany: { company: { name: 'Example Company' } }, units: [{ id: 'unit', unit_number: 1, hole_slot_id: 'slot' }] }];
    else if (url.pathname.endsWith('/m2m_hole_sponsorship_slots')) body = [{ id: 'slot', hole_id: 'hole-2', label: 'Primary sponsor', hole: { hole_number: 2, label: 'Hole 2' }, unit: [{ id: 'unit' }] }];
    else if (url.pathname.endsWith('/m2m_event_companies')) body = [{ id: 'company-event', company: { name: 'Example Company' } }];
    else if (url.pathname.endsWith('/m2m_event_holes')) body = [{ id: 'hole-1', hole_number: 1, label: 'Hole 1' }, { id: 'hole-2', hole_number: 2, label: 'Hole 2' }];
    else throw new Error(`Unexpected endpoint: ${url.pathname}`);
    if (url.pathname.endsWith('/m2m_sponsorship_commitments')) body.push(
      { ...body[0], id: 'cancelled-company-booking', eventCompany: { relationship_status: 'cancelled', company: { name: 'Cancelled Company' } } },
      { ...body[0], id: 'cancelled-booking', status: 'cancelled' },
    );
    if (url.pathname.endsWith('/m2m_event_companies')) body.push({ id: 'cancelled-company', relationship_status: 'cancelled', company: { name: 'Cancelled Company' } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer sample-token' }, query: { eventId: 'event' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.commitments.length, 1);
  assert.equal(res.body.companies.length, 1);
  assert.deepEqual(res.body.holes.map((hole) => hole.number), [1, 2]);
  assert.equal(res.body.holeSlots[0].holeNumber, 2);
  assert.equal(res.body.commitments[0].eventCompanyId, res.body.companies[0].id);
  assert.equal(res.body.commitments[0].units[0].holeSlotId, res.body.holeSlots[0].id);
  assert.equal(res.body.holeSlots[0].unitId, 'unit');
  assert.equal(res.body.commitments[0].requiresHole, true);
  for (const url of requested.filter((url) => url.pathname.startsWith('/rest/v1/') && !url.pathname.endsWith('/m2m_profiles'))) {
    assert.equal(url.searchParams.get('event_id'), 'eq.event');
  }
  const history = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer sample-token' }, query: { eventId: 'event', includeCancelled: 'true' } }, history);
  assert.equal(history.body.commitments.length, 3);
  assert.equal(history.body.companies.length, 1);
  assert.equal(requested.find((url) => url.pathname.endsWith('/m2m_event_holes')).searchParams.get('order'), 'hole_number.asc');
});

test('sponsorship directory requires authentication before loading company data', async () => {
  const res = response();
  await handler({ method: 'GET', headers: {}, query: { eventId: 'event' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'authentication_required');
});


test('fourball directory excludes cancelled participation and preserves explicit history access', async (t) => {
  const { default: fourballs } = await import('../api/v1/admin/fourballs.js');
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    let body;
    if (url.pathname === '/auth/v1/user') body = { id: 'admin' };
    else if (url.pathname.endsWith('/m2m_profiles')) body = url.searchParams.has('id') ? { id: 'admin', role: 'admin', is_active: true } : [];
    else if (url.pathname.endsWith('/m2m_fourballs')) body = [
      { id: 'active', booking_status: 'confirmed', eventCompany: { relationship_status: 'confirmed' } },
      { id: 'cancelled-company', booking_status: 'confirmed', eventCompany: { relationship_status: 'cancelled' } },
      { id: 'cancelled-team', booking_status: 'cancelled', eventCompany: { relationship_status: 'confirmed' } },
    ];
    else if (url.pathname.endsWith('/m2m_tee_slots')) body = [];
    else throw new Error(`Unexpected endpoint: ${url.pathname}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const active = response();
  await fourballs({ method: 'GET', headers: { authorization: 'Bearer sample-token' }, query: { eventId: 'event' } }, active);
  assert.equal(active.statusCode, 200);
  assert.deepEqual(active.body.fourballs.map((team) => team.id), ['active']);
  const history = response();
  await fourballs({ method: 'GET', headers: { authorization: 'Bearer sample-token' }, query: { eventId: 'event', includeCancelled: 'true' } }, history);
  assert.equal(history.statusCode, 200);
  assert.equal(history.body.fourballs.length, 3);
});
