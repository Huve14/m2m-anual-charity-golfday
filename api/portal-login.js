import { isSameOrigin } from "./_admin-auth.js";
import { sendPortalJson, setPortalCookies } from "./_portal-auth.js";
import { authRequest, serviceRest, userRest } from "./_host-store.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function query(parameters) {
  return new URLSearchParams(parameters).toString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendPortalJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!isSameOrigin(req)) {
    sendPortalJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const email = String(body?.email || "").trim().toLowerCase();
    const password = typeof body?.password === "string" ? body.password : "";
    if (!EMAIL_PATTERN.test(email) || password.length < 8 || password.length > 256 || body?.website) {
      throw new Error("invalid_login");
    }
    const session = await authRequest("token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const accountResult = await userRest(
      session.access_token,
      "host_accounts",
      query({ select: "id,company_id,account_status,login_email", auth_user_id: `eq.${session.user.id}`, limit: "1" }),
    );
    const account = accountResult.payload?.[0];
    if (!account || ["suspended", "deactivated", "pending_review"].includes(account.account_status)) {
      throw new Error("portal_access_unavailable");
    }
    if (account.account_status === "invited") {
      await serviceRest("host_accounts", query({ id: `eq.${account.id}` }), {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ account_status: "active" }),
      });
    }
    setPortalCookies(res, session);
    sendPortalJson(res, 200, { ok: true, redirect: "/portal" });
  } catch (error) {
    console.error("[M2M Invitational] host login failed", {
      code: error?.message === "portal_access_unavailable" ? error.message : "invalid_host_login",
    });
    sendPortalJson(res, 401, {
      ok: false,
      message:
        error?.message === "portal_access_unavailable"
          ? "Portal access is not active for this host company."
          : "The email or password was not recognised.",
    });
  }
}

export const config = { maxDuration: 15 };

