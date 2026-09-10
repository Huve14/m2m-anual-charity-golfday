import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { event, eventId, data } from "./fixtures/export-data.mjs";

process.env.SUPABASE_URL = "https://exports.test";
process.env.SUPABASE_SECRET_KEY = "test-secret";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public";
const { default: handler } = await import("../api/v1/admin/exports.js");
const headers = { authorization: "Bearer test-token" };
const tables = { m2m_event_companies: "companies", m2m_fourballs: "fourballs", m2m_players: "players", m2m_fourball_hosts: "hosts", m2m_sponsorship_commitments: "sponsors", m2m_sponsorship_types: "sponsorshipTypes" };
function response() { return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } }; }
function mockDatabase(t, { rows = data, role = "admin", found = true, failTable } = {}) {
  const queries = [], audits = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const table = url.pathname.split("/").at(-1);
    let payload;
    if (url.pathname === "/auth/v1/user") payload = { id: "admin" };
    else if (table === "m2m_profiles") payload = { id: "admin", role, is_active: true };
    else if (table === "m2m_events") { assert.equal(url.searchParams.get("id"), `eq.${eventId}`); payload = found ? event : null; }
    else if (table === "m2m_audit_events") { audits.push(JSON.parse(init.body)); payload = {}; }
    else {
      assert.ok(tables[table], `Unexpected query: ${table}`);
      assert.equal(url.searchParams.get("event_id"), `eq.${eventId}`, "Every export query is scoped to the requested event");
      assert.equal(url.searchParams.get("order"), "id.asc");
      queries.push(url);
      if (table === failTable) return new Response(JSON.stringify({ code: "XX000", message: "Simulated database failure" }), { status: 500, headers: { "content-type": "application/json" } });
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit"));
      payload = (rows[tables[table]] || []).slice(offset, offset + limit);
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { queries, audits };
}

test("admin API delivers a branded multi-tab XLSX with a safe filename and audit record", async (t) => {
  const db = mockDatabase(t);
  const res = response();
  await handler({ method: "GET", headers, query: { eventId, type: "confirmations" } }, res);
  assert.equal(res.statusCode, 200, String(res.body));
  assert.equal(res.headers["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(res.headers["Content-Disposition"], /m2m-golf-day-2026-confirmations-\d{4}-\d{2}-\d{2}\.xlsx/);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  const workbook = await new ExcelJS.Workbook().xlsx.load(res.body);
  assert.equal(workbook.worksheets.length, 11);
  assert.equal(workbook.getWorksheet("Fourballs").getCell("I9").value, 10000.5);
  assert.equal(db.queries.length, 6);
  assert.equal(db.audits.length, 1);
  assert.deepEqual(db.audits[0].metadata, { type: "confirmations", format: "xlsx" });
});

test("exports include more than the default 1,000 database rows", async (t) => {
  const companies = Array.from({ length: 1001 }, (_, index) => ({ ...data.companies[0], id: `company-${index}`, company: { name: `Company ${String(index).padStart(4, "0")}` } }));
  const db = mockDatabase(t, { rows: { companies } });
  const res = response();
  await handler({ method: "GET", headers, query: { eventId, type: "confirmed-companies" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.queries.length, 3);
  const workbook = await new ExcelJS.Workbook().xlsx.load(res.body);
  const sheet = workbook.getWorksheet("Companies");
  assert.equal(sheet.rowCount, 1009);
  assert.equal(sheet.getCell("A1009").value, "Company 1000");
});

test("export endpoint rejects unauthenticated requests and host accounts", async (t) => {
  const db = mockDatabase(t, { role: "host" });
  for (const [requestHeaders, status] of [[{}, 401], [headers, 403]]) {
    const res = response();
    await handler({ method: "GET", headers: requestHeaders, query: { eventId, type: "confirmations" } }, res);
    assert.equal(res.statusCode, status);
  }
  assert.deepEqual(db.queries, []);
  assert.deepEqual(db.audits, []);
});

test("invalid parameters, unsupported methods and missing events return JSON errors", async (t) => {
  mockDatabase(t, { found: false });
  for (const [method, query, status] of [["POST", { eventId }, 405], ["GET", { eventId: "invalid" }, 400], ["GET", { eventId, type: "unknown" }, 400], ["GET", { eventId }, 404]]) {
    const res = response();
    await handler({ method, headers, query }, res);
    assert.equal(res.statusCode, status);
    assert.equal(JSON.parse(res.body).ok, false);
  }
});

test("a failed query cannot produce a partially populated workbook", async (t) => {
  const db = mockDatabase(t, { failTable: "m2m_sponsorship_commitments" });
  t.mock.method(console, "error", () => {});
  const res = response();
  await handler({ method: "GET", headers, query: { eventId, type: "confirmations" } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.headers["Content-Type"], /application\/json/);
  assert.deepEqual(db.audits, []);
});
