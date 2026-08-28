import { createClient } from "@supabase/supabase-js";
import { isSameOrigin } from "./_admin-auth.js";
import { sendPortalJson } from "./_portal-auth.js";
import { normaliseEmail, serviceKey, serviceRest, supabaseUrl } from "./_host-store.js";

function redirectUrl() {
  return String(process.env.HOST_PORTAL_REDIRECT_URL || "").trim();
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
    const email = normaliseEmail(body?.email);
    const query = new URLSearchParams({
      select: "id,account_status,auth_user_id",
      login_email: `eq.${email}`,
      limit: "1",
    });
    const result = await serviceRest("host_accounts", query.toString());
    const account = result.payload?.[0];
    if (account?.auth_user_id && ["invited", "active"].includes(account.account_status)) {
      const client = createClient(supabaseUrl(), serviceKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
    }
  } catch {
    // Avoid disclosing whether a host account exists.
  }
  sendPortalJson(res, 200, { ok: true });
}

