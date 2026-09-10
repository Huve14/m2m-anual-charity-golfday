import assert from 'node:assert/strict';
import test from 'node:test';
import { galaAttendees, galaSheets, loadGalaData } from '../api/_gala.js';
import { buildExportSheets, exportTypes } from '../api/_export-data.js';
import { createExportWorkbook } from '../api/_export-workbook.js';
import { event } from './fixtures/export-data.mjs';
import ExcelJS from 'exceljs';
const party = { id: 'party', name: 'Smith family', table_name: 'Table 4', guests: [{ id: 'wife', fullName: 'Jane Smith', email: '', phone: '', attendance: 'confirmed', dietaryRequirements: 'Nut allergy' }] };
const golfer = { id: 'john', full_name: 'John Smith', dietary_requirements: 'Vegetarian', fourball: { team_name: 'Team A', booking_status: 'confirmed', eventCompany: { relationship_status: 'confirmed', company: { name: 'Acme' } } } };
const data = { parties: [party], players: [golfer], settings: [{ id: 'john', party_id: 'party', attendance: 'confirmed' }] };
test('golfers and dinner companions share a party/table with live player dietary requirements', () => {
  const rows = galaAttendees(data);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(p => p.partyName === 'Smith family' && p.tableName === 'Table 4'));
  assert.equal(rows.find(p => p.id === 'john').dietaryRequirements, 'Vegetarian');
  assert.equal(galaAttendees({ ...data, players: [{ ...golfer, dietary_requirements: 'Vegan' }] }).find(p => p.id === 'john').dietaryRequirements, 'Vegan');
});
test('unnamed slots, cancelled bookings and cancelled companies do not become attendees', () => {
  const players = [golfer, { ...golfer, id: 'blank', full_name: ' ' }, { ...golfer, id: 'cancel', fourball: { ...golfer.fourball, booking_status: 'cancelled' } }, { ...golfer, id: 'company', fourball: { ...golfer.fourball, eventCompany: { relationship_status: 'cancelled' } } }];
  assert.deepEqual(galaAttendees({ players }).map(p => p.id), ['john']);
  assert.equal(galaAttendees({ players })[0].attendance, 'pending');
});
test('confirmed dinner and catering totals exclude pending and declined; holistic register retains them', () => {
  const mixed = { ...data, settings: [], parties: [{ ...party, guests: [...party.guests, { ...party.guests[0], id: 'declined', fullName: 'Not coming', attendance: 'declined' }] }] };
  const sheets = galaSheets(mixed, true);
  assert.equal(sheets[0].rows.length, 1);
  assert.equal(sheets[1].rows.length, 1);
  assert.deepEqual(sheets[2].rows, [['Table 4', 1]]);
  assert.equal(sheets[3].rows.length, 3);
  assert.equal(galaSheets(mixed).length, 3);
  assert.ok(exportTypes.includes('gala') && exportTypes.includes('attendees'));
});
test('gala export is a valid branded Excel workbook with shared table totals', async () => {
  const bytes = await createExportWorkbook(event, buildExportSheets(data, 'attendees'), new Date());
  const book = await new ExcelJS.Workbook().xlsx.load(bytes);
  assert.equal(book.worksheets.length, 4);
  assert.equal(book.getWorksheet('Table totals').getCell('B9').value, 2);
  assert.equal(book.getWorksheet('Gala dinner').getCell('E9').value, 'Table 4');
});
test('gala loading paginates every source and scopes each query by event', async () => {
  const calls = [];
  const client = { from(table) { const q = { select() { return q; }, eq(key, value) { assert.equal(key, 'event_id'); assert.equal(value, 'event'); return q; }, order(key) { assert.equal(key, 'id'); return q; }, async range(start, end) { calls.push([table, start, end]); return { data: Array.from({ length: start === 0 ? 500 : 1 }, () => ({})), error: null }; } }; return q; } };
  const result = await loadGalaData(client, 'event');
  assert.equal(result.players.length, 501);
  assert.equal(result.parties.length, 501);
  assert.equal(calls.length, 6);
});
