import { Composio } from "@composio/core";
import {
  RegistrationInputError,
  buildRegistration,
} from "./_registration.js";
import { createOrUpdateRegistrationAccount } from "./_supabase-account.js";

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

function isConfigured(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function registrationResultState(result) {
  return typeof result === "object" && result !== null ? result.status : "error";
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
    return {
      status: "skipped",
      reason: "Excel sync is not configured.",
    };
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

    if (result.error || !result.logId) {
      const reason = result.error || "storage provider did not return a log id.";
      return {
        status: "error",
        reason: `Registration storage rejected the row: ${JSON.stringify(reason)}`,
      };
    }

    return {
      status: "inserted",
      logId: result.logId,
    };
  } catch (error) {
    return {
      status: "error",
      reason:
        error instanceof Error
          ? error.message
          : "Unexpected error while saving to Excel.",
    };
  }
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
    const excel = await writeToExcel(workbookId, tableId, registration);
    let autoAccount = null;

    try {
      autoAccount = await createOrUpdateRegistrationAccount(
        registration.account,
        registration.supabaseRecord,
      );
    } catch (accountError) {
      console.error("[M2M Invitational] account provisioning failed", accountError);
      autoAccount = {
        status: "error",
        reason:
          accountError instanceof Error
            ? accountError.message
            : "Unknown account provisioning failure",
      };
    }

    const hasSavedRegistration =
      registrationResultState(excel) === "inserted" ||
      registrationResultState(autoAccount) === "created" ||
      registrationResultState(autoAccount) === "updated" ||
      autoAccount?.registrationStatus === "inserted" ||
      autoAccount?.registrationStatus === "duplicate";

    if (!hasSavedRegistration) {
      const reasons = [
        excel.reason || null,
        autoAccount.reason || null,
      ].filter(Boolean);
      throw new Error(
        `No registration sink accepted the submission: ${JSON.stringify(reasons)}`,
      );
    }

    const warnings = [];
    if (excel.status !== "inserted") {
      warnings.push(`Excel status: ${excel.status}`);
    }
    if (autoAccount.status === "error") {
      warnings.push("Supabase account creation failed.");
    }
    if (autoAccount.emailStatus && autoAccount.emailStatus.status !== "sent") {
      warnings.push(`Email status: ${autoAccount.emailStatus.status}`);
    }
    if (autoAccount.emailStatus?.status === "error") {
      const reason = autoAccount.emailStatus.reason
        ? ` (${autoAccount.emailStatus.reason})`
        : "";
      warnings.push(`Failed to email credentials${reason}`);
    }

    send(res, 201, {
      ok: true,
      registrationId: registration.registrationId,
      autoAccount,
      excel,
      warnings: warnings.length > 0 ? warnings : null,
    });
  } catch (error) {
    if (error instanceof RegistrationInputError) {
      send(res, error.statusCode, { ok: false, message: error.message });
      return;
    }
    const reason = error instanceof Error ? error.message : "Unknown registration failure.";
    console.error("[M2M Invitational] registration storage failed", {
      error: reason,
    });
    const friendlyMessage =
      "We could not save your entry right now. Please try again shortly.";
    send(res, 503, {
      ok: false,
      message: friendlyMessage,
      reason,
      friendlyMessage,
    });
  }
}

export const config = {
  maxDuration: 30,
};
