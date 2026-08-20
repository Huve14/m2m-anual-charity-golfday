import assert from "node:assert/strict";
import test from "node:test";
import { PRIVACY_NOTICE_VERSION } from "../api/_registration.js";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
delete process.env.COMPOSIO_API_KEY;
delete process.env.M2M_EXCEL_WORKBOOK_ID;
delete process.env.M2M_EXCEL_TABLE_ID;

const { default: registerHandler } = await import("../api/register.js");

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

test("stores a registration without touching Supabase Auth or returning internals", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 201 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      company: "Security Test Company",
      contactName: "Test Registrant",
      email: "registrant@example.com",
      cellPhone: "+27 82 000 0000",
      fourballs: 1,
      sponsorship: "",
      dietary: "Other",
      dietaryOther: "No beef",
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      registrationConsent: true,
      playerDataConsent: true,
      marketingConsent: false,
    },
  };
  const res = createResponse();

  await registerHandler(req, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(JSON.parse(res.body)).sort(), [
    "message",
    "ok",
    "registrationId",
  ]);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/rest\/v1\/m2m_registrations$/);
  assert.doesNotMatch(requests[0].url, /\/auth\/v1\/admin/);

  const storedRows = JSON.parse(requests[0].init.body);
  assert.equal(storedRows[0].user_id, null);
  assert.equal(storedRows[0].account_status, "pending_secure_invite");
  assert.equal(storedRows[0].dietary_requirements, "Other (No beef)");
  assert.doesNotMatch(requests[0].init.body, /password|temporaryPassword/i);
});

test("rejects non-JSON requests before any storage call", async () => {
  const req = {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "not json",
  };
  const res = createResponse();

  await registerHandler(req, res);

  assert.equal(res.statusCode, 415);
  assert.deepEqual(JSON.parse(res.body), {
    ok: false,
    message: "JSON content is required.",
  });
});
