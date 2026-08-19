import { Composio } from "@composio/core";
import {
  RegistrationInputError,
  buildRegistration,
} from "./_registration.js";

const USER_ID = "m2m-charity-golf-admin";

function send(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32_000) {
    send(res, 413, { ok: false, message: "The registration is too large." });
    return;
  }

  try {
    const body = parseBody(req);
    if (body?.website) {
      send(res, 201, { ok: true });
      return;
    }

    const registration = buildRegistration(body);
    const workbookId = process.env.M2M_EXCEL_WORKBOOK_ID;
    const tableId = process.env.M2M_EXCEL_TABLE_ID;
    if (!process.env.COMPOSIO_API_KEY || !workbookId || !tableId) {
      throw new Error("Registration storage is not configured.");
    }

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

    if (result.error || !result.logId) {
      throw new Error("Registration storage rejected the row.");
    }

    send(res, 201, {
      ok: true,
      registrationId: registration.registrationId,
    });
  } catch (error) {
    if (error instanceof RegistrationInputError) {
      send(res, error.statusCode, { ok: false, message: error.message });
      return;
    }
    console.error("[M2M Invitational] registration storage failed");
    send(res, 503, {
      ok: false,
      message: "We could not save your entry right now. Please try again shortly.",
    });
  }
}

export const config = {
  maxDuration: 30,
};
