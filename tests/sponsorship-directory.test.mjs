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
    if (url.pathname.endsWith('/m2m_hole_sponsorship_slots')) body.push({ id: 'venue-slot', hole_id: null, location_name: 'Putting green', label: 'Prize display', hole: null, unit: [] });
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
  assert.equal(res.body.holeSlots[1].holeNumber, null);
  assert.equal(res.body.holeSlots[1].displayLabel, 'Putting green · Prize display');
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

const supplierEvent = '00000000-0000-4000-8000-000000000001';
const supplierCompany = '00000000-0000-4000-8000-000000000002';
const supplierSlot = '00000000-0000-4000-8000-000000000003';

test('supplier creation passes contribution and optional venue placement through one atomic booking call', async (t) => {
  const mutations = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    let body;
    if (url.pathname === '/auth/v1/user') body = { id: supplierCompany };
    else if (url.pathname.endsWith('/m2m_profiles')) body = { id: supplierCompany, role: 'admin', is_active: true };
    else if (url.pathname.endsWith('/rpc/m2m_create_supplier_sponsorship')) { mutations.push(JSON.parse(init.body)); body = 'booking-id'; }
    else if (url.pathname.endsWith('/m2m_audit_events')) body = [];
    else throw new Error(`Unexpected endpoint: ${url.pathname}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer sample-token', 'content-type': 'application/json' }, body: { action: 'createSupplier', eventId: supplierEvent, eventCompanyId: supplierCompany, contribution: '  200 bottled waters  ', holeSlotId: supplierSlot } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, 'booking-id');
  assert.deepEqual(mutations, [{ p_event_id: supplierEvent, p_event_company_id: supplierCompany, p_contribution: '200 bottled waters', p_slot_id: supplierSlot, p_actor_id: supplierCompany }]);
  const invalid = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer sample-token', 'content-type': 'application/json' }, body: { action: 'createSupplier', eventId: supplierEvent, eventCompanyId: supplierCompany, contribution: '   ' } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(mutations.length, 1);
});

test('venue positions save a named event location without inventing a numbered hole', async (t) => {
  let position;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    let body;
    if (url.pathname === '/auth/v1/user') body = { id: supplierCompany };
    else if (url.pathname.endsWith('/m2m_profiles')) body = { id: supplierCompany, role: 'admin', is_active: true };
    else if (url.pathname.endsWith('/m2m_hole_sponsorship_slots')) { position = JSON.parse(init.body); body = { id: supplierSlot }; }
    else if (url.pathname.endsWith('/m2m_audit_events')) body = [];
    else throw new Error(`Unexpected endpoint: ${url.pathname}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer sample-token', 'content-type': 'application/json' }, body: { action: 'createVenueSlot', eventId: supplierEvent, locationName: 'Putting green', label: 'Prize display' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(position, { event_id: supplierEvent, location_name: 'Putting green', label: 'Prize display' });
});
