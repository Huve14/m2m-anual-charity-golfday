import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  makePasswordHash,
  readAdminSession,
  verifyAdminCredentials,
} from "../api/_admin-auth.js";

const password = "test-admin-password-2026";
process.env.M2M_ADMIN_SESSION_SECRET = "a-test-session-secret-that-is-longer-than-thirty-two-characters";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const admin = {
  id: 7,
  email: "admin@marketing2themax.co.za",
  display_name: "Test Admin",
  password_hash: makePasswordHash(password, "test-admin-salt"),
  role: "super_admin",
  is_active: true,
  session_version: 1,
};

test("accepts only active Supabase-backed admin credentials", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("outsider%40example.com")) {
      return new Response("[]", { status: 200 });
    }
    return new Response(JSON.stringify([admin]), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.equal(
    (await verifyAdminCredentials("ADMIN@marketing2themax.co.za", password))?.id,
    7,
  );
  assert.equal(await verifyAdminCredentials("outsider@example.com", password), null);
  assert.equal(
    await verifyAdminCredentials("admin@marketing2themax.co.za", "wrong-password"),
    null,
  );
});

test("creates an expiring signed HttpOnly-compatible admin session", () => {
  const now = Date.parse("2026-08-26T10:00:00.000Z");
  const session = createAdminSession(admin, now);
  const req = { headers: { cookie: `${ADMIN_COOKIE_NAME}=${session}` } };
  const parsed = readAdminSession(req, now + 60_000);

  assert.equal(parsed.email, "admin@marketing2themax.co.za");
  assert.equal(parsed.id, 7);
  assert.equal(parsed.role, "super_admin");
  assert.equal(readAdminSession(req, now + 9 * 60 * 60 * 1000), null);
});

test("rejects a tampered admin session", () => {
  const now = Date.parse("2026-08-26T10:00:00.000Z");
  const session = createAdminSession(admin, now);
  const req = {
    headers: {
      cookie: `${ADMIN_COOKIE_NAME}=${session.slice(0, -1)}x`,
    },
  };
  assert.equal(readAdminSession(req, now + 60_000), null);
});
