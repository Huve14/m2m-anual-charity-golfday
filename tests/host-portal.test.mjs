import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readSheet } from "read-excel-file/node";

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseImportFile,
} from "../api/_host-import.js";

function validCsv(rows = 1) {
  const header = "Company Name,Contact Name,Surname,Email,Mobile,Fourball Quantity,Sponsorship Type,Company Reference,Hole Number,Booking Reference,Internal Notes";
  const body = Array.from({ length: rows }, (_, index) =>
    `Fictional Host ${index + 1},Test,Person,test${index + 1}@example.invalid,0820000000,1,None,STAGE-${index + 1},,BOOK-${index + 1},Synthetic staging row`,
  );
  return Buffer.from([header, ...body].join("\n"));
}

test("parses the approved value-only CSV template", async () => {
  const result = await parseImportFile("hosts.csv", validCsv(2));
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].parsed.companyName, "Fictional Host 1");
  assert.equal(result.rows[0].parsed.fourballQuantity, 1);
  assert.equal(result.rows[0].parsed.sponsorshipType, "none");
  assert.equal(result.rows[0].errors.length, 0);
  assert.match(result.fileSha256, /^[a-f0-9]{64}$/);
});

test("rejects formula-like CSV values before preview", async () => {
  const csv = validCsv(1).toString().replace("Fictional Host 1", "=HYPERLINK(\"https://invalid\")");
  await assert.rejects(
    () => parseImportFile("hosts.csv", Buffer.from(csv)),
    /spreadsheet_formula_not_allowed/,
  );
});

test("rejects formula-like CSV values in any column", async () => {
  const csv = validCsv(1)
    .toString()
    .replace("Synthetic staging row", "=HYPERLINK(\"https://invalid\")");
  await assert.rejects(
    () => parseImportFile("hosts.csv", Buffer.from(csv)),
    /spreadsheet_formula_not_allowed/,
  );
});

test("rejects formula-containing XLSX archives before cell parsing", async () => {
  const archive = zipSync({
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row><c><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'),
  });
  await assert.rejects(
    () => parseImportFile("hosts.xlsx", Buffer.from(archive)),
    /spreadsheet_formula_not_allowed/,
  );
});

test("enforces file and row limits", async () => {
  assert.equal(MAX_IMPORT_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_IMPORT_ROWS, 500);
  await assert.rejects(
    () => parseImportFile("hosts.csv", Buffer.alloc(MAX_IMPORT_BYTES + 1, 65)),
    /import_file_size/,
  );
  await assert.rejects(
    () => parseImportFile("hosts.csv", validCsv(501)),
    /too_many_import_rows/,
  );
});

test("requires every controlled import header", async () => {
  const missingSurname = validCsv(1).toString().replace(",Surname,", ",");
  await assert.rejects(
    async () => {
      try {
        await parseImportFile("hosts.csv", Buffer.from(missingSurname));
      } catch (error) {
        assert.deepEqual(error.missingHeaders, ["surname"]);
        throw error;
      }
    },
    /missing_required_headers/,
  );
});

test("ships private host pages and leaves the public home route in place", async () => {
  const [home, login, portal, vercel] = await Promise.all([
    fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/host-login.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/portal.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  assert.match(home, /href="\/host-login"/);
  assert.match(login, /noindex,nofollow,noarchive/);
  assert.match(portal, /noindex,nofollow,noarchive/);
  assert.match(vercel, /\/api\/admin\/imports\/:batchId\/commit/);
  assert.match(vercel, /\/api\/portal\/fourballs\/:id\/players/);
});

test("migration enforces tenant RLS, one active sponsor per hole and service-only imports", async () => {
  const migration = await fs.readFile(
    new URL("../supabase/migrations/20260828212856_host_portal_staging.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /booking_allocations_active_hole_unique_idx/);
  assert.match(migration, /account\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /for update to authenticated[\s\S]+using[\s\S]+with check/);
  assert.match(migration, /m2m_unique_player_slots_required/);
  assert.match(migration, /revoke all on function public\.m2m_commit_host_import\(uuid, bigint, text\) from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on public\.admin_audit_log to service_role/);
  assert.match(migration, /public_available, admin_import_available[\s\S]+17000, false/);
});

test("spreadsheet template is generated and downloadable without formulas", async () => {
  const template = await fs.readFile(
    new URL("../public/assets/m2m-host-company-import-template.xlsx", import.meta.url),
  );
  assert.ok(template.length > 1000);
  const archive = unzipSync(new Uint8Array(template));
  const formulaXml = Object.entries(archive)
    .filter(([name]) => /^xl\/worksheets\/.*\.xml$/i.test(name))
    .map(([, bytes]) => strFromU8(bytes))
    .join("\n");
  assert.doesNotMatch(formulaXml, /<f(?:\s|>)/i);
  const rows = await readSheet(template, "Host Import");
  assert.deepEqual(rows[0].slice(0, 4), ["Company Name", "Contact Name", "Surname", "Email"]);
});
