import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";
import { MAX_IMPORT_BYTES } from "./_host-import.js";
import { publishableKey, serviceKey, supabaseUrl } from "./_host-store.js";

const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

function bodyValue(req) {
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

function safeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-160);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }

  try {
    const body = bodyValue(req);
    const fileName = safeFileName(body?.fileName);
    const fileSize = Number(body?.fileSize);
    const contentType = String(body?.contentType || "").toLowerCase();
    const extension = fileName.toLowerCase().split(".").pop();
    if (
      !fileName ||
      !["xlsx", "csv"].includes(extension) ||
      !Number.isInteger(fileSize) ||
      fileSize < 1 ||
      fileSize > MAX_IMPORT_BYTES ||
      !ALLOWED_TYPES.has(contentType)
    ) {
      sendJson(res, 400, {
        ok: false,
        message: "Choose an .xlsx or .csv file no larger than 5 MB.",
      });
      return;
    }

    const path = `admin-${admin.id}/${randomUUID()}-${fileName}`;
    const client = createClient(supabaseUrl(), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.storage
      .from("host-import-staging")
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.signedUrl) throw error || new Error("signed_upload_missing");

    sendJson(res, 200, {
      ok: true,
      upload: {
        path,
        signedUrl: data.signedUrl,
        token: data.token,
        publishableKey: publishableKey(),
      },
    });
  } catch (error) {
    console.error("[M2M Invitational] import upload signing failed", {
      admin: admin.email,
      code: error?.code || error?.name || "signed_upload_failed",
    });
    sendJson(res, 503, {
      ok: false,
      message: "The secure import upload could not be prepared right now.",
    });
  }
}

export const config = { maxDuration: 15 };

