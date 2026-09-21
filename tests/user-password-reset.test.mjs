import assert from 'node:assert/strict';
import test from 'node:test';
process.env.SUPABASE_URL = 'https://password-reset.test';
process.env.SUPABASE_SECRET_KEY = 'test-secret';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public';
const { default: handler } = await import('../api/v1/admin/users.js');
const { requireProfile } = await import('../api/_ops.js');
const actorId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const temporaryPassword = 'Temporary-2026!';
const headers = { authorization: 'Bearer token', 'content-type': 'application/json' };
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, end(body) { this.body = JSON.parse(body); } }; }
function mock(t, { role = 'admin', targetRole = 'host', found = true, profileFailure = false, authFailure = false, mustChange = false } = {}) {
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    let payload; let status = 200;
    if (method !== 'GET') writes.push({ path: url.pathname, method, body, id: url.searchParams.get('id') });
    if (url.pathname === '/auth/v1/user') payload = { id: actorId };
    else if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      payload = authFailure ? { message: 'Rejected', code: 'unexpected_failure' } : { id: profileId };
      status = authFailure ? 422 : 200;
    } else if (url.pathname.endsWith('/m2m_profiles')) {
      if (method === 'PATCH') { payload = profileFailure ? { message: 'Failed' } : {}; status = profileFailure ? 400 : 200; }
      else payload = url.searchParams.get('id') === `eq.${actorId}`
        ? { id: actorId, role, is_active: true, must_change_password: mustChange }
        : found ? { id: profileId, role: targetRole, is_active: true, email: 'user@example.com' } : null;
    } else if (url.pathname.endsWith('/m2m_audit_events')) payload = {};
    else throw new Error(`Unexpected request: ${method} ${url}`);
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  });
  return writes;
}
async function reset(body = {}, requestHeaders = headers) {
  const res = response();
  await handler({ method: 'PATCH', headers: requestHeaders, body: { action: 'resetPassword', profileId, temporaryPassword, ...body } }, res);
  return res;
}
test('admin resets host password, requires replacement and audits without secrets', async t => {
  const writes = mock(t); const res = await reset();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(writes.map(w => w.body), [{ must_change_password: true }, { password: temporaryPassword }, { event_id: null, actor_profile_id: actorId, action: 'user.password_reset', entity_type: 'profile', entity_id: profileId, metadata: {} }]);
  assert.equal(writes[0].id, `eq.${profileId}`);
  assert.equal(writes[1].path, `/auth/v1/admin/users/${profileId}`);
  assert.ok(!JSON.stringify(res.body).includes(temporaryPassword));
});
for (const targetRole of ['admin', 'super_admin']) {
  test(`regular admin cannot reset ${targetRole}`, async t => { const writes = mock(t, { targetRole }); assert.equal((await reset()).statusCode, 403); assert.equal(writes.length, 0); });
  test(`super admin can reset ${targetRole}`, async t => { mock(t, { role: 'super_admin', targetRole }); assert.equal((await reset()).statusCode, 200); });
  test(`invite cannot bypass ${targetRole} reset permissions`, async t => {
    const writes = mock(t, { targetRole }); const res = response();
    await handler({ method: 'POST', headers, body: { email: 'user@example.com', fullName: 'Test User', role: 'host', temporaryPassword } }, res);
    assert.equal(res.statusCode, 403); assert.equal(writes.length, 0);
  });
}
test('unauthenticated users and hosts cannot reset passwords', async t => {
  const writes = mock(t, { role: 'host' });
  assert.equal((await reset({}, {})).statusCode, 401);
  assert.equal((await reset()).statusCode, 403); assert.equal(writes.length, 0);
});
test('invalid passwords and IDs never write', async t => {
  const writes = mock(t);
  for (const password of ['', 'short', 'onlylowercase123!', 'NOLOWERCASE123!', 'NoNumbersHere!!', 'NoSymbols123456', 'Aa1!' + 'x'.repeat(125)]) assert.equal((await reset({ temporaryPassword: password })).statusCode, 400);
  assert.equal((await reset({ profileId: 'invalid' })).statusCode, 400);
  assert.equal(writes.length, 0);
});
test('missing users and self resets are rejected', async t => {
  const writes = mock(t, { role: 'super_admin', found: false });
  assert.equal((await reset()).statusCode, 404);
  assert.equal((await reset({ profileId: actorId })).statusCode, 409);
  assert.equal(writes.length, 0);
});
test('profile failure prevents password changes', async t => {
  const writes = mock(t, { profileFailure: true });
  assert.equal((await reset()).statusCode, 503);
  assert.equal(writes.length, 1);
});
test('Auth failure does not report success or remove the password-change gate', async t => {
  const writes = mock(t, { authFailure: true });
  assert.equal((await reset()).statusCode, 503);
  assert.deepEqual(writes.map(w => w.body), [{ must_change_password: true }, { password: temporaryPassword }]);
});
test('users requiring a password change cannot access protected operations', async t => {
  mock(t, { mustChange: true });
  await assert.rejects(requireProfile({ headers }), { code: 'password_change_required' });
});
