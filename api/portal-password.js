import { isSameOrigin } from "./_admin-auth.js";
import { portalSession, sendPortalJson } from "./_portal-auth.js";
import { authRequest, serviceRest } from "./_host-store.js";

function validPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
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
  const session = await portalSession(req, res);
  if (!session) {
    sendPortalJson(res, 401, { ok: false, message: "Open a valid access link first." });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!validPassword(body?.password)) {
      sendPortalJson(res, 400, {
        ok: false,
        message: "Use at least 12 characters with uppercase, lowercase, a number and a symbol.",
      });
      return;
    }
    await authRequest("user", {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ password: body.password }),
    });
    const query = new URLSearchParams({ auth_user_id: `eq.${session.user.id}` });
    await serviceRest("host_accounts", query.toString(), {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ account_status: "active" }),
    });
    sendPortalJson(res, 200, { ok: true, redirect: "/portal" });
  } catch (error) {
    console.error("[M2M Invitational] host password setup failed", {
      code: error?.code || "password_setup_failed",
    });
    sendPortalJson(res, 503, { ok: false, message: "Your password could not be saved right now." });
  }
}

