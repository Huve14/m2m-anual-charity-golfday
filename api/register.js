import { Composio } from "@composio/core";
import {
  RegistrationInputError,
  buildRegistration,
} from "./_registration.js";
import { storeRegistrationSecurely } from "./_supabase-account.js";

const USER_ID = "m2m-charity-golf-admin";
const MAX_BODY_BYTES = 32_000;

function send(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new RegistrationInputError("The registration could not be read.");
    }
  }
  return req.body;
}

function isConfigured(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function excelConfigured() {
  return (
    isConfigured(process.env.M2M_EXCEL_WORKBOOK_ID) &&
    isConfigured(process.env.M2M_EXCEL_TABLE_ID) &&
    isConfigured(process.env.COMPOSIO_API_KEY)
  );
}

async function writeToExcel(workbookId, tableId, registration) {
  if (!excelConfigured()) {
    return "skipped";
  }

  try {
    const composio = new Composio();
    const session = await composio.sessions.create(USER_ID, {
      toolkits: ["excel"],
      manageConnections: false,
      sandbox: { enable: false },
    });
    const result = await session.execute("EXCEL_ADD_TABLE_ROW", {
      drive_id: "me",
      item_id: workbookId,
      table_id: tableId,
      values: [registration.row],
    });
    return !result.error && result.logId ? "inserted" : "error";
  } catch {
    return "error";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    send(res, 415, { ok: false, message: "JSON content is required." });
    return;
  }

  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    send(res, 413, { ok: false, message: "The registration is too large." });
    return;
  }

  try {
    if (
      typeof req.body === "string" &&
      Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES
    ) {
      send(res, 413, { ok: false, message: "The registration is too large." });
      return;
    }

    const body = parseBody(req);
    const measuredLength = Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
    if (measuredLength > MAX_BODY_BYTES) {
      send(res, 413, { ok: false, message: "The registration is too large." });
      return;
    }

    if (body?.website) {
      send(res, 201, { ok: true, message: "Registration received." });
      return;
    }

    const registration = buildRegistration(body);
    await storeRegistrationSecurely(
      registration.account,
      registration.supabaseRecord,
    );

    const excelStatus = await writeToExcel(
      process.env.M2M_EXCEL_WORKBOOK_ID,
      process.env.M2M_EXCEL_TABLE_ID,
      registration,
    );
    if (excelStatus === "error") {
      console.warn("[M2M Invitational] optional Excel sync failed", {
        registrationId: registration.registrationId,
      });
    }

    send(res, 201, {
      ok: true,
      registrationId: registration.registrationId,
      message: "Registration received.",
    });
  } catch (error) {
    if (error instanceof RegistrationInputError) {
      send(res, error.statusCode, { ok: false, message: error.message });
      return;
    }

    console.error("[M2M Invitational] registration request failed", {
      code: error?.code || "registration_failed",
      status: Number.isInteger(error?.status) ? error.status : null,
    });
    send(res, 503, {
      ok: false,
      message: "We could not save your entry right now. Please try again shortly.",
    });
  }
}

export const config = {
  maxDuration: 30,
};
