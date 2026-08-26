import {
  isSameOrigin,
  makeRandomPasswordHash,
  requireAdmin,
  sendJson,
} from "./_admin-auth.js";
import {
  createAdminUser,
  listAdminUsers,
  normaliseAdminEmail,
} from "./_admin-store.js";

const MAX_BODY_BYTES = 4_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function publicUser(user) {
  return {
    id: Number(user.id),
    email: user.email,
    displayName: user.display_name || "",
    role: user.role,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at || null,
    createdByEmail: user.created_by_email || null,
  };
}

async function listUsers(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const users = await listAdminUsers();
    sendJson(res, 200, {
      ok: true,
      users: users.map(publicUser),
      canCreateSuperAdmins: admin.role === "super_admin",
    });
  } catch (error) {
    console.error("[M2M Invitational] admin user list failed", {
      code: error?.code || "admin_user_list_failed",
      admin: admin.email,
    });
    sendJson(res, 503, {
      ok: false,
      message: "Administrator accounts could not be loaded right now.",
    });
  }
}

async function createUser(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
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
    sendJson(res, 415, { ok: false, message: "Valid account details are required." });
    return;
  }

  try {
    const body = parseBody(req);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      JSON.stringify(body).length > MAX_BODY_BYTES ||
      body.website
    ) {
      throw Object.assign(new Error("invalid_account"), { status: 400 });
    }

    const email = normaliseAdminEmail(body.email).slice(0, 254);
    const displayName = String(body.displayName || "").trim().slice(0, 120);
    const password = typeof body.password === "string" ? body.password : "";
    const requestedRole = body.role === "super_admin" ? "super_admin" : "admin";
    const role = admin.role === "super_admin" ? requestedRole : "admin";

    if (!EMAIL_PATTERN.test(email) || !displayName || displayName.length < 2) {
      throw Object.assign(new Error("invalid_account"), { status: 400 });
    }
    if (!validPassword(password)) {
      throw Object.assign(new Error("weak_password"), { status: 400 });
    }

    const user = await createAdminUser({
      email,
      display_name: displayName,
      password_hash: makeRandomPasswordHash(password),
      role,
      is_active: true,
      session_version: 1,
      created_by_email: admin.email,
    });
    sendJson(res, 201, { ok: true, user: publicUser(user) });
  } catch (error) {
    if (error?.code === "admin_email_exists" || error?.status === 409) {
      sendJson(res, 409, {
        ok: false,
        message: "An administrator with this email address already exists.",
      });
      return;
    }
    if (error?.message === "weak_password") {
      sendJson(res, 400, {
        ok: false,
        message:
          "Use at least 12 characters with uppercase, lowercase, a number and a symbol.",
      });
      return;
    }
    if (error?.message === "invalid_account") {
      sendJson(res, 400, {
        ok: false,
        message: "Enter a valid name, email address and temporary password.",
      });
      return;
    }
    console.error("[M2M Invitational] admin user creation failed", {
      code: error?.code || "admin_user_create_failed",
      admin: admin.email,
    });
    sendJson(res, 503, {
      ok: false,
      message: "The administrator could not be created right now.",
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    await listUsers(req, res);
    return;
  }
  if (req.method === "POST") {
    await createUser(req, res);
    return;
  }
  res.setHeader("Allow", "GET, POST");
  sendJson(res, 405, { ok: false, message: "Method not allowed." });
}

export const config = { maxDuration: 20 };
