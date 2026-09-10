import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import readXlsxFile from "read-excel-file/node";
import { unzipSync, strFromU8 } from "fflate";
import { buildExportSheets, exportTypes } from "../api/_export-data.js";
import { createExportWorkbook } from "../api/_export-workbook.js";
import { event, data } from "./fixtures/export-data.mjs";

test("combined confirmations separate every sponsorship type and reconcile without double-counting units", () => {
  const sheets = buildExportSheets(data, "confirmations");
  const sheet = (name) => sheets.find((entry) => entry.name === name);
  for (const name of ["Summary", "Companies", "Fourballs", "Players", "Hosts", "Suppliers", "Alcoholic Hole", "Non-alcoholic Hole", "Branded Hole", "Custom Confirmation", "Empty Sponsorship Type"]) assert.ok(sheet(name), name);
  for (const name of ["Companies", "Fourballs", "Players", "Hosts", "Alcoholic Hole"]) assert.equal(sheet(name).rows.length, 1, name);
  assert.equal(sheet("Suppliers").rows.length, 2, "Unallocated suppliers are retained");
  assert.equal(sheet("Empty Sponsorship Type").rows.length, 0);
  assert.equal(sheet("Fourballs").rows[0][5], "Hole 1 A", "Unique tee relationship may be an object");
  assert.equal(sheet("Fourballs").rows[0][8], 10000.5);
  assert.equal(sheet("Alcoholic Hole").rows[0][4], 2);
  assert.equal(sheet("Alcoholic Hole").rows[0][8], 1234.5, "Commitment amount occurs once for two units");
  assert.match(sheet("Alcoholic Hole").rows[0][5], /1: Hole 4 · A\n2: Unallocated/);
  assert.deepEqual(sheet("Summary").rows[2], ["Sponsorships", 4, 8, 4938, 0, 4]);
  assert.deepEqual(sheet("Summary").rows[3], ["Suppliers", 2, 4, 0, 5000.5, 1]);
});

test("individual exports distinguish confirmations from all-status operational reports", () => {
  assert.equal(buildExportSheets(data, "fourballs")[0].rows.length, 4);
  assert.equal(buildExportSheets(data, "confirmed-fourballs")[0].rows.length, 1);
  assert.equal(buildExportSheets(data, "sponsors")[0].rows.length, 7);
  assert.equal(buildExportSheets(data, "suppliers")[0].rows.length, 2);
  assert.equal(buildExportSheets(data, "confirmed-sponsors").length, 5);
  for (const type of exportTypes) assert.ok(buildExportSheets({}, type).length >= 1, `Empty ${type} export still contains a sheet`);
});

test("saved Excel workbooks retain branding, typed Rand values, literal text, dates and navigation", async () => {
  const bytes = await createExportWorkbook(event, buildExportSheets(data, "confirmations"));
  const workbook = await new ExcelJS.Workbook().xlsx.load(bytes);
  const suppliers = workbook.getWorksheet("Suppliers");
  assert.equal(workbook.creator, "Marketing 2 The Max");
  assert.equal(suppliers.getCell("H9").value, 5000.5);
  assert.match(suppliers.getCell("H9").numFmt, /"R "/);
  assert.equal(suppliers.getCell("H10").value, null, "Unvalued is distinct from zero");
  const players = workbook.getWorksheet("Players");
  assert.equal(players.getCell("D9").value, "=Literal player name");
  assert.equal(players.getCell("D9").type, ExcelJS.ValueType.String);
  assert.equal(players.getCell("F9").value, "+27000123456");
  assert.equal(players.getCell("L9").value, "000123");
  assert.equal(workbook.getWorksheet("Hosts").getCell("F9").value.toISOString(), "2026-09-10T10:00:00.000Z", "Excel shows event-local time");
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.getImages().length, 1);
    assert.equal(sheet.views[0].ySplit, 8);
    assert.equal(sheet.views[0].showGridLines, false);
    assert.ok(sheet.autoFilter.startsWith("A8:"));
    assert.equal(sheet.getCell("A8").fill.fgColor.argb, "FF0C1735");
    assert.match(sheet.getCell("A5").value, /Glendower Golf Club/);
  }
  const independent = await readXlsxFile(bytes, { sheet: "Fourballs" });
  assert.equal(independent.find((sheet) => sheet.sheet === "Fourballs").data[8][8], 10000.5, "An independent Excel reader sees a numeric Rand amount");
  const zip = unzipSync(bytes);
  assert.ok(Object.keys(zip).some((path) => /^xl\/media\/.*\.png$/.test(path)));
  for (const [path, value] of Object.entries(zip)) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) assert.doesNotMatch(strFromU8(value), /<f[ >]/, "User values never become formulas");
});

test("tab names remain valid and unique for long, duplicate and reserved sponsorship names", async () => {
  const template = buildExportSheets({}, "confirmed-companies")[0];
  const names = ["Suppliers", "suppliers", "a".repeat(45), "a".repeat(44) + "b", "History", "'Bad/Name:*?[]'", "''"];
  const bytes = await createExportWorkbook(event, names.map((name) => ({ ...template, name })));
  const workbook = await new ExcelJS.Workbook().xlsx.load(bytes);
  const savedNames = workbook.worksheets.map((sheet) => sheet.name);
  assert.equal(new Set(savedNames.map((name) => name.toLowerCase())).size, names.length);
  for (const name of savedNames) { assert.ok(name.length <= 31); assert.doesNotMatch(name, /[\\/*?:[\]]/); assert.notEqual(name.toLowerCase(), "history"); }
});
