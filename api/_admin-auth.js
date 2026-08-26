import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  adminStoreConfigured,
  findAdminByEmail,
  findAdminById,
  normaliseAdminEmail,
} from "./_admin-store.js";

export const ADMIN_COOKIE_NAME = "m2m_golf_admin";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

const SCRYPT_KEY_LENGTH = 64;
const DEFAULT_SCRYPT_OPTIONS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
let fallbackPasswordHash = "";

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sessionSecret() {
  return stringValue(process.env.M2M_ADMIN_SESSION_SECRET);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function constantTimeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || "");
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        return [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
}

function sign(encodedPayload) {
  return createHmac("sha256", sessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function authConfigured() {
  return sessionSecret().length >= 32 && adminStoreConfigured();
}

export function makePasswordHash(password, salt) {
  const actualSalt = String(salt || "");
  if (!actualSalt) throw new Error("A password salt is required.");
  const derived = scryptSync(
    String(password),
    actualSalt,
    SCRYPT_KEY_LENGTH,
    DEFAULT_SCRYPT_OPTIONS,
  );
  return [
    "scrypt",
    DEFAULT_SCRYPT_OPTIONS.N,
    DEFAULT_SCRYPT_OPTIONS.r,
    DEFAULT_SCRYPT_OPTIONS.p,
    Buffer.from(actualSalt).toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function makeRandomPasswordHash(password) {
  return makePasswordHash(password, randomBytes(18).toString("base64url"));
}

export function verifyPasswordHash(password, storedHash) {
  const parts = stringValue(storedHash).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, encodedSalt, encodedHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (N !== 16384 || r !== 8 || p !== 1) return false;

  try {
    const salt = Buffer.from(encodedSalt, "base64url").toString();
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = scryptSync(String(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: DEFAULT_SCRYPT_OPTIONS.maxmem,
    });
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function verifyAdminCredentials(email, password) {
  if (!authConfigured()) return null;
  const normalisedEmail = normaliseAdminEmail(email);
  const suppliedPassword = typeof password === "string" ? password : "";
  if (!normalisedEmail || !suppliedPassword) return null;

  const admin = await findAdminByEmail(normalisedEmail);
  if (!fallbackPasswordHash) {
    fallbackPasswordHash = makePasswordHash(
      "not-a-valid-admin-password",
      "m2m-admin-timing-fallback",
    );
  }
  const validPassword = verifyPasswordHash(
    suppliedPassword,
    admin?.password_hash || fallbackPasswordHash,
  );
  if (!admin || !admin.is_active || !validPassword) return null;
  return admin;
}

export function createAdminSession(admin, now = Date.now()) {
  if (!authConfigured()) throw new Error("Admin authentication is unavailable.");
  if (!admin || !Number.isSafeInteger(Number(admin.id))) {
    throw new Error("A valid administrator is required.");
  }
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    id: Number(admin.id),
    email: normaliseAdminEmail(admin.email),
    name: stringValue(admin.display_name),
    role: admin.role === "super_admin" ? "super_admin" : "admin",
    sv: Number(admin.session_version) || 1,
    iat: issuedAt,
    exp: issuedAt + ADMIN_SESSION_TTL_SECONDS,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function readAdminSession(req, now = Date.now()) {
  if (!authConfigured()) return null;
  const value = parseCookies(req)[ADMIN_COOKIE_NAME] || "";
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const encodedPayload = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!constantTimeEqual(suppliedSignature, sign(encodedPayload))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    const currentTime = Math.floor(now / 1000);
    if (
      !Number.isSafeInteger(Number(payload.id)) ||
      !normaliseAdminEmail(payload.email) ||
      !["admin", "super_admin"].includes(payload.role) ||
      payload.exp <= currentTime ||
      payload.iat > currentTime + 30
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function adminCookie(session) {
  return [
    `${ADMIN_COOKIE_NAME}=${session}`,
    "Path=/",
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Priority=High",
  ].join("; ");
}

export function expiredAdminCookie() {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function setPrivateHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

export function sendJson(res, status, payload) {
  setPrivateHeaders(res);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function requireAdmin(req, res) {
  const session = readAdminSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, message: "Admin sign-in required." });
    return null;
  }
  try {
    const admin = await findAdminById(session.id);
    if (
      !admin ||
      !admin.is_active ||
      normaliseAdminEmail(admin.email) !== normaliseAdminEmail(session.email) ||
      admin.role !== session.role ||
      Number(admin.session_version) !== Number(session.sv)
    ) {
      sendJson(res, 401, { ok: false, message: "Admin sign-in required." });
      return null;
    }
    return {
      id: Number(admin.id),
      email: normaliseAdminEmail(admin.email),
      displayName: stringValue(admin.display_name),
      role: admin.role,
      exp: session.exp,
    };
  } catch {
    sendJson(res, 503, {
      ok: false,
      message: "Admin access could not be verified right now.",
    });
    return null;
  }
}

export function isSameOrigin(req) {
  const site = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = stringValue(req.headers?.origin);
  if (!origin) return false;
  const host = stringValue(req.headers?.["x-forwarded-host"] || req.headers?.host)
    .split(",")[0]
    .trim();
  const protocol = stringValue(req.headers?.["x-forwarded-proto"])
    .split(",")[0]
    .trim() || (host.startsWith("localhost") ? "http" : "https");
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}
