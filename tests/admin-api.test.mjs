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
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const admin = {
  id: 9,
  email: adminEmail,
  display_name: "Admin User",
  password_hash: makePasswordHash(adminPassword, "admin-api-test-salt"),
  role: "super_admin",
  is_active: true,
  session_version: 1,
};

const { default: loginHandler } = await import("../api/admin-login.js");
const { default: registrationsHandler } = await import("../api/admin-registrations.js");
const { default: usersHandler } = await import("../api/admin-users.js");

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

test("creates a secure cookie without returning a session token", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PATCH") return new Response(null, { status: 204 });
    return new Response(JSON.stringify([admin]), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
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
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    admin: {
      email: adminEmail,
      displayName: "Admin User",
      role: "super_admin",
    },
  });
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
    if (String(url).includes("/m2m_admin_users?")) {
      return new Response(
        JSON.stringify([
          {
            id: admin.id,
            email: admin.email,
            display_name: admin.display_name,
            role: admin.role,
            is_active: true,
            session_version: 1,
          },
        ]),
        { status: 200 },
      );
    }
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

  const session = createAdminSession(admin);
  const req = {
    method: "GET",
    headers: { cookie: `${ADMIN_COOKIE_NAME}=${session}` },
  };
  const res = createResponse();
  await registrationsHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/rest\/v1\/m2m_registrations\?/);
  assert.doesNotMatch(requests[1].url, /raw_registration|user_id|consent_text_snapshot/);
  assert.equal(requests[1].init.headers.apikey, "test-service-role");
  assert.equal(requests[1].init.headers.Authorization, "Bearer test-service-role");
  const payload = JSON.parse(res.body);
  assert.equal(payload.total, 1);
  assert.equal(payload.registrations[0].registration_id, "M2M-TEST123");
});

test("creates individual admin users with only a password hash sent to Supabase", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (!init.method || init.method === "GET") {
      return new Response(
        JSON.stringify([
          {
            id: admin.id,
            email: admin.email,
            display_name: admin.display_name,
            role: admin.role,
            is_active: true,
            session_version: 1,
          },
        ]),
        { status: 200 },
      );
    }
    const saved = JSON.parse(init.body)[0];
    return new Response(
      JSON.stringify([
        {
          id: 10,
          email: saved.email,
          display_name: saved.display_name,
          role: saved.role,
          is_active: true,
          created_at: "2026-08-26T12:00:00.000Z",
          last_login_at: null,
          created_by_email: saved.created_by_email,
        },
      ]),
      { status: 201 },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const password = "Secure-Admin-2026!";
  const session = createAdminSession(admin);
  const req = {
    method: "POST",
    headers: {
      cookie: `${ADMIN_COOKIE_NAME}=${session}`,
      "content-type": "application/json",
      origin: "https://golfday.marketing2themax.co.za",
      host: "golfday.marketing2themax.co.za",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
    body: {
      displayName: "New Admin",
      email: "new.admin@example.com",
      password,
      role: "admin",
      website: "",
    },
  };
  const res = createResponse();
  await usersHandler(req, res);

  assert.equal(res.statusCode, 201);
  const insert = requests.find((request) => request.init.method === "POST");
  const stored = JSON.parse(insert.init.body)[0];
  assert.equal(stored.password, undefined);
  assert.notEqual(stored.password_hash, password);
  assert.match(stored.password_hash, /^scrypt\$16384\$8\$1\$/);
  assert.doesNotMatch(res.body, /Secure-Admin-2026/);
});

test("standard administrators cannot grant super-administrator access", async (t) => {
  const originalFetch = globalThis.fetch;
  const standardAdmin = { ...admin, id: 11, role: "admin" };
  let storedRole = null;
  globalThis.fetch = async (url, init = {}) => {
    if (!init.method || init.method === "GET") {
      return new Response(JSON.stringify([standardAdmin]), { status: 200 });
    }
    const saved = JSON.parse(init.body)[0];
    storedRole = saved.role;
    return new Response(
      JSON.stringify([
        {
          id: 12,
          email: saved.email,
          display_name: saved.display_name,
          role: saved.role,
          is_active: true,
          created_at: "2026-08-26T12:00:00.000Z",
          last_login_at: null,
          created_by_email: saved.created_by_email,
        },
      ]),
      { status: 201 },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const session = createAdminSession(standardAdmin);
  const res = createResponse();
  await usersHandler(
    {
      method: "POST",
      headers: {
        cookie: `${ADMIN_COOKIE_NAME}=${session}`,
        "content-type": "application/json",
        origin: "https://golfday.marketing2themax.co.za",
        host: "golfday.marketing2themax.co.za",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      },
      body: {
        displayName: "Another Admin",
        email: "another.admin@example.com",
        password: "Secure-Admin-2026!",
        role: "super_admin",
        website: "",
      },
    },
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(storedRole, "admin");
  assert.equal(JSON.parse(res.body).user.role, "admin");
});
