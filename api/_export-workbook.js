import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

export const EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HEADER_ROW = 8;
const fallbackLogo = new URL("../public/assets/m2m-logo.png", import.meta.url);
const colour = (value, fallback) => /^#[\da-f]{6}$/i.test(value || "") ? `FF${value.slice(1).toUpperCase()}` : fallback;
// XML 1.0 cannot represent these control characters in spreadsheet text.
// eslint-disable-next-line no-control-regex
const cleanText = (value) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function sheetName(name, used) {
  const base = cleanText(name).replace(/[\\/*?:[\]]/g, " ").trim().replace(/^'+|'+$/g, "").slice(0, 31).replace(/'+$/g, "") || "Report";
  let candidate = base;
  for (let number = 2; used.has(candidate.toLowerCase()) || candidate.toLowerCase() === "history"; number += 1) {
    const suffix = ` (${number})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function timezoneFor(event) {
  try { new Intl.DateTimeFormat("en-ZA", { timeZone: event.timezone }).format(); return event.timezone || "Africa/Johannesburg"; }
  catch { return "Africa/Johannesburg"; }
}

function localDate(value, timeZone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}

export async function createExportWorkbook(event, sheets, generatedAt = new Date()) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Marketing 2 The Max";
  workbook.title = `${event.name} — ${sheets[0].title}`;
  workbook.subject = "Golf day operations";
  workbook.created = generatedAt;
  const logo = workbook.addImage({ buffer: await readFile(fallbackLogo), extension: "png" });
  const primary = colour(event.primary_colour, "FF0C1735");
  const accent = colour(event.accent_colour, "FFED1C24");
  const rgb = [2, 4, 6].map((start) => parseInt(primary.slice(start, start + 2), 16));
  const headerText = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 160 ? "FF0C1735" : "FFFFFFFF";
  const currency = /^[A-Z]{3}$/.test(event.currency || "") ? event.currency : "ZAR";
  const moneyFormat = (code) => `"${code === "ZAR" ? "R" : code} "#,##0.00;[Red]("${code === "ZAR" ? "R" : code} "#,##0.00);"${code === "ZAR" ? "R" : code} "0.00`;
  const timeZone = timezoneFor(event);
  const dateFormat = new Intl.DateTimeFormat("en-ZA", { timeZone, dateStyle: "medium", timeStyle: "short" });
  const generated = dateFormat.format(generatedAt);
  const eventDate = event.shotgun_start_at ? dateFormat.format(new Date(event.shotgun_start_at)) : "Date to be confirmed";
  const usedNames = new Set();

  for (const report of sheets) {
    const sheet = workbook.addWorksheet(sheetName(report.name, usedNames), {
      properties: { tabColor: { argb: primary } },
      views: [{ state: "frozen", xSplit: 1, ySplit: HEADER_ROW, showGridLines: false }],
      pageSetup: { paperSize: 8, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `1:${HEADER_ROW}`, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } },
      headerFooter: { oddFooter: "&LMarketing 2 The Max&C&A&RPage &P of &N" },
    });
    sheet.columns = report.columns.map((entry) => ({ width: entry.width }));
    const last = report.columns.length;
    for (let row = 1; row <= 3; row += 1) {
      sheet.getRow(row).height = 18;
      for (let col = 1; col <= last; col += 1) sheet.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0C1735" } };
    }
    sheet.addImage(logo, { tl: { col: 0.08, row: 0.25 }, ext: { width: 240, height: 60 }, editAs: "absolute" });
    for (const [row, value, height] of [
      [4, report.title, 30],
      [5, `${event.name} · ${event.venue_name || "Venue to be confirmed"} · ${eventDate}`, 30],
      [6, `${report.note}\nExported ${generated} (${timeZone}).`, report.noteHeight || 42],
    ]) {
      sheet.mergeCells(row, 1, row, last);
      const cell = sheet.getCell(row, 1);
      cell.value = cleanText(value);
      cell.font = { name: "Arial", size: row === 4 ? 16 : 10, bold: row === 4, color: { argb: row === 4 ? primary : "FF536176" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      sheet.getRow(row).height = height;
      if (row === 4) cell.border = { bottom: { style: "thin", color: { argb: accent } } };
    }
    sheet.getRow(7).height = 8;
    const header = sheet.getRow(HEADER_ROW);
    header.values = report.columns.map((entry) => entry.format === "money" && !entry.name.includes("(ZAR)") ? `${entry.name} (${currency})` : entry.name);
    header.height = 32;
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: primary } };
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: headerText } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    report.columns.forEach((definition, index) => {
      if (definition.editable) {
        header.getCell(index + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF245B88" } };
        header.getCell(index + 1).font = { ...header.getCell(index + 1).font, color: { argb: "FFFFFFFF" } };
      }
    });
    for (const values of report.rows) {
      const row = sheet.addRow(values.map((value, index) => {
        if (value == null) return null;
        if (report.columns[index].format === "date") return localDate(value, timeZone);
        // Strings remain literal cells, never formulas, including =, +, - and @ prefixes.
        return typeof value === "number" ? value : cleanText(value);
      }));
      let lines = 1;
      for (let index = 0; index < last; index += 1) {
        const cell = row.getCell(index + 1);
        const definition = report.columns[index];
        cell.font = { name: "Arial", size: 10, color: { argb: "FF17243B" } };
        cell.alignment = { vertical: "top", wrapText: true, horizontal: ["money", "integer"].includes(definition.format) ? "right" : "left" };
        if (definition.format === "money") cell.numFmt = moneyFormat(definition.name.includes("(ZAR)") ? "ZAR" : currency);
        if (definition.format === "integer") cell.numFmt = "#,##0";
        if (definition.format === "date") cell.numFmt = definition.editable ? "dd mmm yyyy" : "dd mmm yyyy hh:mm";
        if (row.number % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F4F8" } };
        if (definition.editable) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF3FC" } };
          cell.font = { ...cell.font, color: { argb: "FF245B88" } };
          if (definition.options) cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${definition.options.join(",")}"`], showErrorMessage: true, errorTitle: "Choose an invoice status", error: "Select a status from the dropdown.", errorStyle: "stop" };
        }
        if (typeof values[index] === "string") lines = Math.max(lines, values[index].split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / (definition.width - 3))), 0));
      }
      row.height = Math.min(409, Math.max(28, lines * 14 + 10));
    }
    if (!report.rows.length) {
      sheet.mergeCells(HEADER_ROW + 1, 1, HEADER_ROW + 1, last);
      const cell = sheet.getCell(HEADER_ROW + 1, 1);
      cell.value = "No matching records for this event.";
      cell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF536176" } };
      sheet.getRow(HEADER_ROW + 1).height = 30;
    }
    sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: Math.max(HEADER_ROW, HEADER_ROW + report.rows.length), column: last } };
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(last).letter}${sheet.rowCount}`;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
