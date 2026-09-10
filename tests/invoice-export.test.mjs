import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildExportSheets, loadExportData } from "../api/_export-data.js";
import { createExportWorkbook } from "../api/_export-workbook.js";
import { event } from "./fixtures/export-data.mjs";

const company = { id: "ctm", relationship_status: "confirmed", company: { name: "CTM", billing_email: "accounts@example.test" }, primary_contact_name: "Invoice contact", primary_contact_email: "contact@example.test" };
const fourball = { id: "booking", eventCompany: company, team_name: "CTM fourball", booking_status: "confirmed", confirmed_amount_minor: 1000050, payment_status: "unpaid" };
const sponsorship = { id: "hole", eventCompany: company, type: { name: "Branded hole", category: "branded_hole" }, quantity: 2, status: "confirmed", confirmed_amount_minor: 250025, payment_status: "unpaid", units: [{ unit_number: 1 }, { unit_number: 2 }] };
const rowObject = (sheet, row) => Object.fromEntries(sheet.columns.map((column, index) => [column.name, row[index]]));
const tracker = (input) => { const sheet = buildExportSheets(input, "invoices")[0]; return sheet.rows.map((row) => rowObject(sheet, row)); };

test("one company receives one invoice total for fourballs plus hole commitments", () => {
  const rows = tracker({ fourballs: [fourball], sponsors: [sponsorship] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Company, "CTM");
  assert.equal(rows[0]["Fourball amount"], 10000.5);
  assert.equal(rows[0]["Sponsorship amount"], 2500.25, "The commitment total is not multiplied by its two allocation units");
  assert.equal(rows[0]["Total to invoice"], 12500.75);
  assert.equal(rows[0]["Billing email"], "accounts@example.test");
  assert.equal(rows[0]["Invoice status"], "To invoice");
});

test("waived bookings are visible and contribute exactly zero, including fully waived companies", () => {
  for (const waiveFourball of [false, true]) {
    const input = { fourballs: [{ ...fourball, payment_status: waiveFourball ? "waived" : "unpaid" }], sponsors: [{ ...sponsorship, payment_status: "waived" }] };
    const rows = tracker(input);
    assert.equal(rows[0]["Sponsorship amount"], 0);
    assert.equal(rows[0]["Waived amount"], waiveFourball ? 12500.75 : 2500.25);
    assert.equal(rows[0]["Total to invoice"], waiveFourball ? 0 : 10000.5);
    assert.equal(rows[0]["Invoice status"], waiveFourball ? "No invoice required" : "To invoice");
    const items = buildExportSheets(input, "invoices")[1];
    assert.equal(rowObject(items, items.rows.find((row) => row[1] === "Sponsorship"))["Amount to invoice"], 0);
  }
});

test("excludes unconfirmed and cancelled bookings and never invoices prize donation valuations", () => {
  const rows = tracker({ fourballs: [{ ...fourball, booking_status: "pending" }, { ...fourball, booking_status: "cancelled" }, { ...fourball, eventCompany: { ...company, relationship_status: "cancelled" } }], sponsors: [{ ...sponsorship, status: "reserved" }, { ...sponsorship, status: "draft" }, { ...sponsorship, status: "cancelled" }, { ...sponsorship, type: { name: "Prize hamper", category: "supplier" }, confirmed_amount_minor: 0, prize_value_minor: 900000 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Fourballs, 0);
  assert.equal(rows[0]["Total to invoice"], 0);
  assert.equal(rows[0]["Invoice status"], "No invoice required");
});

test("distinct companies with the same name stay separate and existing references prompt review", () => {
  const rows = tracker({ fourballs: [{ ...fourball, invoice_reference: "INV-001", payment_status: "paid" }, { ...fourball, id: "booking2", eventCompany: { ...company, id: "another-company" }, payment_status: "partial" }] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Existing invoice references"], "INV-001");
  assert.equal(rows[0]["Invoice status"], "Review existing invoice");
  assert.equal(rows[1]["Invoice status"], "Review payment");
  assert.equal(rows[0]["Total to invoice"], 10000.5, "Invoice value does not pretend to be an outstanding balance");
});

test("invoice workbook retains numeric zero, editable tracking columns and status dropdowns", async () => {
  const sheets = buildExportSheets({ fourballs: [{ ...fourball, payment_status: "waived" }], sponsors: [] }, "invoices");
  const bytes = await createExportWorkbook(event, sheets);
  const workbook = await new ExcelJS.Workbook().xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Invoice tracker", "Invoice items"]);
  const sheet = workbook.getWorksheet("Invoice tracker");
  const cell = (name) => sheet.getCell(9, sheets[0].columns.findIndex((column) => column.name === name) + 1);
  assert.equal(cell("Total to invoice").value, 0);
  assert.match(cell("Total to invoice").numFmt, /"R "/);
  assert.equal(cell("Invoice status").dataValidation.type, "list");
  assert.equal(cell("Invoice number").value, null);
  assert.equal(cell("Invoice number").fill.fgColor.argb, "FFEAF3FC");
  assert.equal(cell("Invoice date").numFmt, "dd mmm yyyy");
  assert.equal(sheet.getImages().length, 1);
});

test("invoice loading scopes both booking queries to the event and requests company identity and billing email", async () => {
  const requests = [];
  const client = { from(table) { const request = { table }; requests.push(request); return { select(value) { request.select = value; return this; }, eq(key, value) { assert.equal(key, "event_id"); assert.equal(value, event.id); return this; }, order() { return this; }, async range() { return { data: [], error: null }; } }; } };
  const data = await loadExportData(client, event.id, "invoices");
  assert.deepEqual(Object.keys(data).sort(), ["fourballs", "sponsors"]);
  assert.equal(requests.length, 2);
  for (const request of requests) { assert.match(request.select, /eventCompany:m2m_event_companies\(id,/); assert.match(request.select, /billing_email/); }
});
