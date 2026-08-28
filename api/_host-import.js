import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { readSheet } from "read-excel-file/node";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

const REQUIRED_HEADERS = new Map([
  ["company name", "companyName"],
  ["contact name", "contactFirstName"],
  ["surname", "contactSurname"],
  ["email", "contactEmail"],
  ["mobile", "mobile"],
  ["fourball quantity", "fourballQuantity"],
  ["sponsorship type", "sponsorshipType"],
]);

const OPTIONAL_HEADERS = new Map([
  ["company reference", "companyReference"],
  ["hole number", "holeNumber"],
  ["booking reference", "bookingReference"],
  ["internal notes", "internalNotes"],
]);

const SPONSORSHIP_ALIASES = new Map([
  ["", "none"],
  ["none", "none"],
  ["no hole sponsorship", "none"],
  ["without alcohol", "hole-without-alcohol"],
  ["hole sponsorship without alcohol", "hole-without-alcohol"],
  ["hole-without-alcohol", "hole-without-alcohol"],
  ["with alcohol", "hole-with-alcohol"],
  ["hole sponsorship with alcohol", "hole-with-alcohol"],
  ["hole-with-alcohol", "hole-with-alcohol"],
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normaliseHeader(value) {
  return text(value, 100).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("csv_unclosed_quote");
  cells.push(value);
  return cells;
}

function parseCsv(buffer) {
  const source = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows = source
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseCsvLine);
  if (
    rows.some((row) =>
      row.some((cell) => {
        const value = String(cell ?? "").trimStart();
        return /^[=+@]/.test(value) || /^-\s*[A-Za-z(]/.test(value);
      }),
    )
  ) {
    throw new Error("spreadsheet_formula_not_allowed");
  }
  return rows;
}

function inspectXlsx(buffer) {
  let archive;
  try {
    archive = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("invalid_xlsx");
  }
  const entryNames = Object.keys(archive);
  if (entryNames.some((name) => /vbaProject|macrosheets|xl\/externalLinks/i.test(name))) {
    throw new Error("spreadsheet_macro_not_allowed");
  }
  for (const name of entryNames) {
    if (/^xl\/worksheets\/.*\.xml$/i.test(name)) {
      const xml = strFromU8(archive[name]);
      if (/<f(?:\s|>)/i.test(xml)) throw new Error("spreadsheet_formula_not_allowed");
    }
  }
}

function mapHeaders(headerRow) {
  const mapping = new Map();
  const missing = new Set(REQUIRED_HEADERS.keys());
  headerRow.forEach((value, index) => {
    const header = normaliseHeader(value);
    const field = REQUIRED_HEADERS.get(header) || OPTIONAL_HEADERS.get(header);
    if (field) {
      mapping.set(index, field);
      missing.delete(header);
    }
  });
  if (missing.size) {
    const error = new Error("missing_required_headers");
    error.missingHeaders = [...missing];
    throw error;
  }
  return mapping;
}

function rowObject(row, mapping) {
  const result = {};
  for (const [index, field] of mapping) result[field] = row[index] ?? "";
  return result;
}

function parseQuantity(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isInteger(number) ? number : Number.NaN;
}

function normaliseRow(raw, rowNumber) {
  const sponsorshipRaw = text(raw.sponsorshipType, 120).toLowerCase().replace(/\s+/g, " ");
  const sponsorshipType = SPONSORSHIP_ALIASES.get(sponsorshipRaw);
  const fourballQuantity = parseQuantity(raw.fourballQuantity);
  const holeNumber = text(raw.holeNumber, 10) ? Number(raw.holeNumber) : null;
  const parsed = {
    companyReference: text(raw.companyReference, 80),
    companyName: text(raw.companyName, 180),
    contactFirstName: text(raw.contactFirstName, 100),
    contactSurname: text(raw.contactSurname, 100),
    contactEmail: text(raw.contactEmail, 254).toLowerCase(),
    mobile: text(raw.mobile, 40),
    fourballQuantity,
    sponsorshipType: sponsorshipType || sponsorshipRaw,
    holeNumber,
    bookingReference: text(raw.bookingReference, 80),
    internalNotes: text(raw.internalNotes, 2_000),
  };
  const errors = [];
  if (!parsed.companyName) errors.push("Company name is required.");
  if (!parsed.contactFirstName) errors.push("Contact name is required.");
  if (!parsed.contactSurname) errors.push("Surname is required.");
  if (!EMAIL_PATTERN.test(parsed.contactEmail)) errors.push("A valid contact email is required.");
  if (parsed.mobile.length < 7) errors.push("A valid mobile number is required.");
  if (!Number.isInteger(fourballQuantity) || fourballQuantity < 0 || fourballQuantity > 20) {
    errors.push("Fourball quantity must be a whole number from 0 to 20.");
  }
  if (!sponsorshipType) errors.push("Sponsorship type is not recognised.");
  if (holeNumber !== null && (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18)) {
    errors.push("Hole number must be blank or a whole number from 1 to 18.");
  }
  if (holeNumber !== null && sponsorshipType === "none") {
    errors.push("A hole number requires a sponsorship allocation.");
  }
  if ((fourballQuantity || 0) === 0 && sponsorshipType === "none") {
    errors.push("Each host company requires at least one allocation.");
  }
  return { rowNumber, raw, parsed, errors };
}

export async function parseImportFile(fileName, buffer) {
  const name = text(fileName, 255);
  const extension = name.toLowerCase().split(".").pop();
  if (!name || !["xlsx", "csv"].includes(extension)) throw new Error("unsupported_import_file");
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMPORT_BYTES) {
    throw new Error("import_file_size");
  }

  let rows;
  if (extension === "xlsx") {
    inspectXlsx(buffer);
    rows = await readSheet(buffer, 1);
  } else {
    rows = parseCsv(buffer);
  }
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("empty_import_file");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error("too_many_import_rows");

  const mapping = mapHeaders(rows[0]);
  const parsedRows = rows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => text(value)))
    .map(({ row, rowNumber }) => normaliseRow(rowObject(row, mapping), rowNumber));
  if (!parsedRows.length) throw new Error("empty_import_file");

  return {
    fileName: name,
    fileSha256: createHash("sha256").update(buffer).digest("hex"),
    rows: parsedRows,
  };
}
