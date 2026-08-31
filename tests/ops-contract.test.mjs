import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { fromSupabase, validate } from "../api/_ops.js";

const migrationUrl = new URL("../supabase/migrations/20260829053332_create_multi_event_golf_management.sql", import.meta.url);
const fourballTypesMigrationUrl = new URL("../supabase/migrations/20260829185408_add_fourball_types_and_bulk_bookings.sql", import.meta.url);
const companyHostsMigrationUrl = new URL("../supabase/migrations/20260830072515_link_company_primary_contacts_to_hosts.sql", import.meta.url);

test("defines the isolated multi-event operations model without replacing legacy storage", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const tables = [
    "m2m_profiles", "m2m_events", "m2m_event_holes", "m2m_companies", "m2m_event_companies",
    "m2m_sponsorship_types", "m2m_sponsorship_commitments", "m2m_hole_sponsorship_slots",
    "m2m_sponsorship_units", "m2m_fourballs", "m2m_tee_slots", "m2m_fourball_hosts", "m2m_players",
    "m2m_event_player_fields", "m2m_player_field_responses", "m2m_notification_deliveries",
    "m2m_audit_events", "m2m_legacy_enquiry_conversions",
  ];
  for (const table of tables) assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.m2m_registrations/i);
  assert.match(sql, /foreign key \(event_company_id, event_id\)/);
  assert.match(sql, /foreign key \(fourball_id, event_id\)/);
  assert.match(sql, /foreign key \(sponsorship_type_id, event_id\)/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.m2m_submit_fourball[\s\S]+to service_role/);
});

test("enforces capacity, allocations, tee uniqueness, primary hosts, deadlines and completion transactionally", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /m2m_sponsorship_capacity_exceeded/);
  assert.match(sql, /m2m_sponsorship_capacity_below_committed/);
  assert.match(sql, /m2m_allocated_units_prevent_quantity_reduction/);
  assert.match(sql, /unique \(hole_slot_id\)/);
  assert.match(sql, /unique \(fourball_id\)/);
  assert.match(sql, /where is_primary/);
  assert.match(sql, /m2m_hole_slot_type_mismatch/);
  assert.match(sql, /m2m_player_deadline_passed/);
  assert.match(sql, /m2m_player_details_incomplete/);
  assert.match(sql, /m2m_custom_player_details_incomplete/);
  assert.match(sql, /m2m_event_setup_incomplete/);
});

test("supports editable fourball types and transactional bulk client bookings", async () => {
  const [sql, api, ui] = await Promise.all([
    readFile(fourballTypesMigrationUrl, "utf8"),
    readFile(new URL("../api/v1/admin/fourballs.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /create table public\.m2m_fourball_types/);
  assert.match(sql, /m2m_fourball_capacity_exceeded/);
  assert.match(sql, /m2m_fourball_capacity_below_booked/);
  assert.match(sql, /create or replace function public\.m2m_create_fourball_booking/);
  assert.match(sql, /grant execute on function public\.m2m_create_fourball_booking[\s\S]+to service_role/);
  assert.match(api, /m2m_create_fourball_booking/);
  assert.match(ui, /Adjusted total value/);
  assert.match(ui, /Assign existing host/);
});

test("creates company contacts as reusable hosts without downgrading administrator roles", async () => {
  const [sql, companies, users, ui] = await Promise.all([
    readFile(companyHostsMigrationUrl, "utf8"),
    readFile(new URL("../api/v1/admin/companies.js", import.meta.url), "utf8"),
    readFile(new URL("../api/v1/admin/users.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /primary_contact_profile_id uuid/);
  assert.match(sql, /insert into public\.m2m_fourball_hosts/);
  assert.match(companies, /ensureContactProfile/);
  assert.match(users, /existing && input\.role === "host" \? existing\.role : input\.role/);
  assert.doesNotMatch(ui, /profile\.role === "host" && !fourball\.hosts/);
});

test("keeps operational data behind authenticated versioned APIs", async () => {
  const paths = [
    "events", "dashboard", "companies", "sponsorships", "fourballs", "fourball-types", "player-fields", "branding",
    "exports", "users", "reminders", "enquiries",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(`../api/v1/admin/${path}.js`, import.meta.url), "utf8");
    assert.match(source, /requireAdmin|requireSuperAdmin/);
  }
  const host = await readFile(new URL("../api/v1/host/index.js", import.meta.url), "utf8");
  assert.match(host, /requireHostAssignment\(profile\.id, input\.eventId, input\.fourballId\)/);
  assert.match(host, /\.eq\("profile_id", profile\.id\)/);
  assert.match(host, /fourball_locked/);
  assert.match(host, /deadline_passed/);
  assert.doesNotMatch(host, /confirmed_amount_minor|payment_status|invoice_reference/);
});

test("standardises write validation and safe operational errors", () => {
  assert.deepEqual(validate(z.object({ name: z.string().min(2) }), { name: "Golf" }), { name: "Golf" });
  assert.throws(
    () => validate(z.object({ email: z.string().email() }), { email: "not-an-email" }),
    (error) => Boolean(error.code === "validation_failed" && error.status === 400 && error.fieldErrors.email),
  );
  const capacity = fromSupabase({ message: "m2m_sponsorship_capacity_exceeded" });
  assert.equal(capacity.code, "sponsorship_capacity_exceeded");
  assert.equal(capacity.status, 409);
  const duplicate = fromSupabase({ code: "23505", message: "detail that must not be exposed" });
  assert.equal(duplicate.code, "duplicate_record");
  assert.doesNotMatch(duplicate.message, /detail that must not be exposed/);
});

test("configures event-scoped branding, reminder deduplication and the daily cron", async () => {
  const [sql, reminders, vercel] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../api/_reminders.js", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /m2m-event-branding/);
  assert.match(sql, /image\/png.*image\/jpeg.*image\/webp/s);
  assert.match(reminders, /dedupeKey = `reminder:\$\{eventId\}:\$\{fourballId\}:\$\{profileId\}/);
  assert.match(vercel, /"schedule": "0 6 \* \* \*"/);
  assert.match(vercel, /\/api\/v1\/cron-reminders/);
});

test("completes Supabase invite callbacks and returns administrators to admin", async () => {
  const callback = await readFile(new URL("../src/auth-main.tsx", import.meta.url), "utf8");
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /setSession\(\{ access_token: accessToken, refresh_token: refreshToken \}\)/);
  assert.match(callback, /fetch\("\/api\/v1\/admin\/events"/);
  assert.match(callback, /response\.ok \? "\/admin" : "\/host"/);
  assert.match(callback, /href="\/admin">Administrator sign in/);
});

test("uses provisioned passwords and forces replacement of temporary credentials", async () => {
  const auth = await readFile(new URL("../src/ops/Auth.tsx", import.meta.url), "utf8");
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /Change password/);
  assert.match(auth, /mustChangePassword/);
  assert.doesNotMatch(auth, /signInWithOtp/);
});

test("imports confirmed company workbooks transactionally and idempotently", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260830075803_add_confirmed_company_imports.sql", import.meta.url), "utf8");
  const api = await readFile(new URL("../api/v1/admin/confirmed-imports.js", import.meta.url), "utf8");
  const admin = await readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8");
  assert.match(migration, /m2m_import_confirmed_companies/);
  assert.match(migration, /unique \(event_id, file_sha256\)/);
  assert.match(migration, /m2m_create_fourball_booking/);
  assert.match(migration, /status, quantity,[\s\S]*'confirmed', 1/);
  assert.match(api, /requireAdmin/);
  assert.match(api, /companies: z\.array\(companySchema\)\.min\(1\)\.max\(500\)/);
  assert.match(admin, /Remove spreadsheet formulas before importing/);
  assert.match(admin, /Review warnings/);
  assert.match(admin, /Import confirmed list/);
});
test("edits company details and sponsorship commercial records", async () => {
  const [companies, sponsorships, admin] = await Promise.all([
    readFile(new URL("../api/v1/admin/companies.js", import.meta.url), "utf8"),
    readFile(new URL("../api/v1/admin/sponsorships.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(companies, /from\("m2m_companies"\)\.update\(companyChanges\)/);
  assert.match(companies, /\.eq\("event_id", input\.eventId\)/);
  assert.match(sponsorships, /action: z\.literal\("updateCommitment"\)/);
  assert.match(sponsorships, /confirmed_amount_minor/);
  assert.match(sponsorships, /payment_status/);
  assert.match(admin, /Edit company/);
  assert.match(admin, /Edit quantity, price and payment/);
  assert.match(admin, /Save sponsorship/);
});
test("supports event-scoped host creation, co-hosts and primary reassignment", async () => {
  const [migration, fourballs, users, admin] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260831050251_reassign_fourball_hosts.sql", import.meta.url), "utf8"),
    readFile(new URL("../api/v1/admin/fourballs.js", import.meta.url), "utf8"),
    readFile(new URL("../api/v1/admin/users.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin/AdminApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /m2m_assign_fourball_host/);
  assert.match(migration, /where event_id = p_event_id[\s\S]*fourball_id = p_fourball_id/);
  assert.match(migration, /on conflict \(fourball_id, profile_id\) do update/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(fourballs, /rpc\("m2m_assign_fourball_host"/);
  assert.match(users, /rpc\("m2m_assign_fourball_host"/);
  assert.match(admin, /Add co-host/);
  assert.match(admin, /Make primary/);
  assert.match(admin, /Remove .* from this fourball/);
});
