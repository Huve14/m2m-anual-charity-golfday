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
process.env.M2M_ADMIN_EMAILS = "admin@marketing2themax.co.za,support@marketing2themax.co.za";
process.env.M2M_ADMIN_SESSION_SECRET = "a-test-session-secret-that-is-longer-than-thirty-two-characters";
process.env.M2M_ADMIN_PASSWORD_HASH = makePasswordHash(password, "test-admin-salt");

test("accepts only allowlisted admin credentials", () => {
  assert.equal(
    verifyAdminCredentials("ADMIN@marketing2themax.co.za", password),
    true,
  );
  assert.equal(
    verifyAdminCredentials("outsider@example.com", password),
    false,
  );
  assert.equal(
    verifyAdminCredentials("admin@marketing2themax.co.za", "wrong-password"),
    false,
  );
});

test("creates an expiring signed HttpOnly-compatible admin session", () => {
  const now = Date.parse("2026-08-26T10:00:00.000Z");
  const session = createAdminSession("admin@marketing2themax.co.za", now);
  const req = { headers: { cookie: `${ADMIN_COOKIE_NAME}=${session}` } };
  const parsed = readAdminSession(req, now + 60_000);

  assert.equal(parsed.email, "admin@marketing2themax.co.za");
  assert.equal(readAdminSession(req, now + 9 * 60 * 60 * 1000), null);
});

test("rejects a tampered admin session", () => {
  const now = Date.parse("2026-08-26T10:00:00.000Z");
  const session = createAdminSession("admin@marketing2themax.co.za", now);
  const req = {
    headers: {
      cookie: `${ADMIN_COOKIE_NAME}=${session.slice(0, -1)}x`,
    },
  };
  assert.equal(readAdminSession(req, now + 60_000), null);
});
