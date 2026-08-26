import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_COOKIE_NAME,
  createAdminSession,
  makePasswordHash,
} from "../api/_admin-auth.js";

const adminEmail = "admin@marketing2themax.co.za";
const adminPassword = "test-admin-password-2026";
process.env.M2M_ADMIN_EMAILS = adminEmail;
process.env.M2M_ADMIN_SESSION_SECRET = "a-test-session-secret-that-is-longer-than-thirty-two-characters";
process.env.M2M_ADMIN_PASSWORD_HASH = makePasswordHash(adminPassword, "admin-api-test-salt");
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const { default: loginHandler } = await import("../api/admin-login.js");
const { default: registrationsHandler } = await import("../api/admin-registrations.js");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
    },
  };
}

test("creates a secure cookie without returning a session token", async () => {
  const req = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://golfday.marketing2themax.co.za",
      host: "golfday.marketing2themax.co.za",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
    body: { email: adminEmail, password: adminPassword, website: "" },
  };
  const res = createResponse();

  await loginHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["set-cookie"], /HttpOnly/);
  assert.match(res.headers["set-cookie"], /Secure/);
  assert.match(res.headers["set-cookie"], /SameSite=Strict/);
  assert.deepEqual(JSON.parse(res.body), { ok: true, email: adminEmail });
});

test("does not read registration data without a valid admin session", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("[]", { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const res = createResponse();
  await registrationsHandler({ method: "GET", headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
});

test("reads only selected private fields through the server after admin authentication", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify([
        {
          registration_id: "M2M-TEST123",
          contact_name: "Test Registrant",
          total_amount: 15000,
        },
      ]),
      { status: 200, headers: { "content-range": "0-0/1" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const session = createAdminSession(adminEmail);
  const req = {
    method: "GET",
    headers: { cookie: `${ADMIN_COOKIE_NAME}=${session}` },
  };
  const res = createResponse();
  await registrationsHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/rest\/v1\/m2m_registrations\?/);
  assert.doesNotMatch(requests[0].url, /raw_registration|user_id|consent_text_snapshot/);
  assert.equal(requests[0].init.headers.apikey, "test-service-role");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-service-role");
  const payload = JSON.parse(res.body);
  assert.equal(payload.total, 1);
  assert.equal(payload.registrations[0].registration_id, "M2M-TEST123");
});
