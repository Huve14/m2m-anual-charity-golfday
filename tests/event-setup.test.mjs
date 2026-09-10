import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { validate, sendJson, sendError, parseJsonBody } from "../api/_ops.js";

const source = await readFile(new URL("../api/v1/admin/events.js", import.meta.url), "utf8");
const id = "11111111-1111-4111-8111-111111111111";
const initial = {
  id, name: "Charity Golf Day", slug: "charity-golf-day", status: "active",
  venue_name: "Glendower", venue_address: "Club address", format: "Scramble",
  timezone: "Africa/Johannesburg", currency: "ZAR", rules: "Custom event rules",
  primary_colour: "#123456", accent_colour: "#654321",
  visible_player_fields: ["full_name", "handicap"], required_player_fields: ["full_name"],
  shirt_size_options: ["S", "M"], reminder_offsets_days: [3], logo_path: "/old.png",
  shotgun_start_at: "2026-10-01T10:00:00Z", registration_deadline_at: null, player_deadline_at: null,
};

function fixture() {
  let row = structuredClone(initial);
  const writes = [];
  const client = { from(table) {
    assert.equal(table, "m2m_events");
    return {
      update(changes) { writes.push(changes); return { async eq(key, value) { assert.equal(key, "id"); assert.equal(value, id); row = { ...row, ...changes }; return { error: null }; } }; },
      select() { return { eq() { return { async single() { return { data: structuredClone(row), error: null }; } }; } }; },
    };
  } };
  const executable = source.replace(/^import[\s\S]*?from "\.\.\/\.\.\/_ops.js";\n/, "")
    .replace("export default async function handler", "async function handler")
    .replace("export const config", "const config");
  const handler = new Function("z", "adminClient", "requireAdmin", "recordAudit", "validate", "sendJson", "sendError", "parseJsonBody", "fromSupabase", `${executable}; return handler;`)(
    z, () => client, async () => ({ id }), async () => {}, validate, sendJson, sendError, parseJsonBody, (error) => error,
  );
  return { writes, async patch(body) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; }, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: "PATCH", headers: { "content-type": "application/json" }, body: { id, action: "update", ...body } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body.event;
  } };
}

test("logo-only save persists the image without resetting any event settings", async () => {
  const { patch, writes } = fixture();
  const event = await patch({ logoPath: "https://example.com/new-logo.png" });
  assert.deepEqual(writes, [{ logo_path: "https://example.com/new-logo.png" }]);
  assert.equal(event.logoPath, "https://example.com/new-logo.png");
  assert.equal(event.venueName, initial.venue_name);
  assert.equal(event.rules, initial.rules);
  assert.deepEqual(event.visiblePlayerFields, initial.visible_player_fields);
  assert.deepEqual(event.requiredPlayerFields, initial.required_player_fields);
});

test("fourball field choices survive a subsequent branding save and readback", async () => {
  const { patch } = fixture();
  await patch({ visiblePlayerFields: ["full_name", "golf_id"], requiredPlayerFields: ["full_name", "email"] });
  const event = await patch({ bannerPath: "https://example.com/banner.png" });
  assert.deepEqual(event.visiblePlayerFields, ["full_name", "golf_id"]);
  assert.deepEqual(event.requiredPlayerFields, ["full_name"]);
  assert.equal(event.format, "Scramble");
});

test("explicit clearing is retained while omitted fields stay unchanged", async () => {
  const { patch, writes } = fixture();
  const event = await patch({ logoPath: null, rules: "", registrationDeadlineAt: "", visiblePlayerFields: [], requiredPlayerFields: [] });
  assert.equal(event.logoPath, null);
  assert.equal(event.rules, "");
  assert.equal(event.registrationDeadlineAt, null);
  assert.deepEqual(event.visiblePlayerFields, []);
  assert.deepEqual(event.requiredPlayerFields, []);
  assert.equal(event.shotgunStartAt, initial.shotgun_start_at);
  assert.equal(Object.hasOwn(writes[0], "shirt_size_options"), false);
});
