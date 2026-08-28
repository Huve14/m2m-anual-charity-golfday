import { authRequest } from "./_host-store.js";

export const ACCESS_COOKIE = "m2m_host_access";
export const REFRESH_COOKIE = "m2m_host_refresh";

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers?.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0
          ? [part, ""]
          : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function cookie(name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Number(maxAge) || 0)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Priority=High",
  ].join("; ");
}

export function setPortalCookies(res, session) {
  const expiresIn = Math.max(60, Number(session?.expires_in) || 3600);
  res.setHeader("Set-Cookie", [
    cookie(ACCESS_COOKIE, session.access_token, expiresIn),
    cookie(REFRESH_COOKIE, session.refresh_token, 30 * 24 * 60 * 60),
  ]);
}

export function clearPortalCookies(res) {
  res.setHeader("Set-Cookie", [cookie(ACCESS_COOKIE, "", 0), cookie(REFRESH_COOKIE, "", 0)]);
}

export function portalTokens(req) {
  const cookies = parseCookies(req);
  return {
    accessToken: cookies[ACCESS_COOKIE] || "",
    refreshToken: cookies[REFRESH_COOKIE] || "",
  };
}

export function setPortalPrivateHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

export function sendPortalJson(res, status, payload) {
  setPortalPrivateHeaders(res);
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function portalSession(req, res) {
  const tokens = portalTokens(req);
  if (tokens.accessToken) {
    try {
      const user = await authRequest("user", {
        method: "GET",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user };
    } catch {
      // Refresh below.
    }
  }
  if (!tokens.refreshToken) return null;
  try {
    const session = await authRequest("token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    });
    setPortalCookies(res, session);
    return { accessToken: session.access_token, refreshToken: session.refresh_token, user: session.user };
  } catch {
    clearPortalCookies(res);
    return null;
  }
}

