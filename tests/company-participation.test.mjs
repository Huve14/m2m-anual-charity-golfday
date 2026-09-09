import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://company.test';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public';
const { default: handler } = await import('../api/v1/admin/companies.js');
const eventId = '10000000-0000-4000-8000-000000000001';
const companyId = '20000000-0000-4000-8000-000000000001';
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, end(body) { this.body = JSON.parse(body); } }; }

test('participation saves independently and a later company-details save does not reset it', async (t) => {
  const row = { id: companyId, event_id: eventId, company_id: 'directory-id', relationship_status: 'confirmed', company: { name: 'Sample Company' } };
  const mutations = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    let body;
    if (url.pathname === '/auth/v1/user') body = { id: 'admin' };
    else if (url.pathname.endsWith('/m2m_profiles')) body = { id: 'admin', role: 'admin', is_active: true };
    else if (url.pathname.endsWith('/m2m_event_companies')) {
      if (init.method === 'PATCH') { const fields = JSON.parse(init.body); mutations.push(fields); Object.assign(row, fields); }
      body = url.searchParams.has('id') ? row : [row];
    } else if (url.pathname.endsWith('/m2m_companies')) {
      if (init.method === 'PATCH') Object.assign(row.company, JSON.parse(init.body));
      body = [];
    } else if (url.pathname.endsWith('/m2m_audit_events')) body = {};
    else throw new Error(`Unexpected request during status-only save: ${url.pathname}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const headers = { authorization: 'Bearer sample-token', 'content-type': 'application/json' };
  const saved = response();
  await handler({ method: 'PATCH', headers, body: { id: companyId, eventId, relationshipStatus: 'cancelled' } }, saved);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.company.relationshipStatus, 'cancelled');
  assert.deepEqual(mutations, [{ relationship_status: 'cancelled' }]);
  const details = response();
  await handler({ method: 'PATCH', headers, body: { id: companyId, eventId, name: 'Updated Company' } }, details);
  assert.equal(details.statusCode, 200);
  assert.equal(details.body.company.relationshipStatus, 'cancelled');
  assert.equal(details.body.company.name, 'Updated Company');
  assert.equal(mutations.length, 1, 'details-only save must not submit a default participation status');
  const listed = response();
  await handler({ method: 'GET', headers, query: { eventId } }, listed);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.companies[0].relationshipStatus, 'cancelled');
});
