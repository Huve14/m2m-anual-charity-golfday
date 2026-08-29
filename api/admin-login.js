import {
  adminCookie,
  authConfigured,
  createAdminSession,
  isSameOrigin,
  sendJson,
  verifyAdminCredentials,
} from "./_admin-auth.js";
import { recordAdminLogin } from "./_admin-store.js";

const MAX_BODY_BYTES = 2_000;
const MIN_FAILURE_DELAY_MS = 550;

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authConfigured()) {
    sendJson(res, 503, { ok: false, message: "Admin access is not configured." });
    return;
  }
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const contentLength = Number(req.headers["content-length"] || 0);
  if (
    !contentType.startsWith("application/json") ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES)
  ) {
    sendJson(res, 415, { ok: false, message: "A valid sign-in is required." });
    return;
  }

  const startedAt = Date.now();
  try {
    const body = parseBody(req);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      JSON.stringify(body).length > MAX_BODY_BYTES ||
      body.website
    ) {
      throw new Error("invalid_login");
    }
    const email = typeof body.email === "string" ? body.email.slice(0, 254) : "";
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    const admin = await verifyAdminCredentials(email, password);
    if (!admin) {
      throw new Error("invalid_login");
    }
    await recordAdminLogin(admin.id);
    res.setHeader("Set-Cookie", adminCookie(createAdminSession(admin)));
    sendJson(res, 200, {
      ok: true,
      admin: {
        email: admin.email,
        displayName: admin.display_name || "",
        role: admin.role,
      },
    });
  } catch {
    const remaining = MIN_FAILURE_DELAY_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    sendJson(res, 401, {
      ok: false,
      message: "The email or password was not recognised.",
    });
  }
}

export const config = { maxDuration: 10 };
