import { createClient } from "@supabase/supabase-js";
import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";
import { auditAdmin, uuidValue } from "./_host-admin.js";
import { normaliseEmail, serviceKey, serviceRest, supabaseUrl } from "./_host-store.js";

function query(parameters) {
  return new URLSearchParams(parameters).toString();
}

function allowedRecipients() {
  const configured = String(process.env.PORTAL_INVITE_ALLOWLIST || "")
    .split(",")
    .map(normaliseEmail)
    .filter(Boolean);
  return new Set(
    configured.length
      ? configured
      : ["huve@marketing2themax.co.za", "jaryd@marketing2themax.co.za"],
  );
}

function redirectUrl() {
  return String(process.env.HOST_PORTAL_REDIRECT_URL || "").trim();
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
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const accountId = uuidValue(req.query?.id || body?.accountId);
    if (!accountId || body?.confirmed !== true) {
      sendJson(res, 400, { ok: false, message: "Review and confirm the exact recipient first." });
      return;
    }
    const accountResult = await serviceRest(
      "host_accounts",
      query({
        select: "id,company_id,login_email,auth_user_id,account_status,invited_at,host_companies(company_name,contact_first_name,contact_surname,host_bookings(id,booking_allocations(id,allocation_type,hole_number,package_catalog(display_name))))",
        id: `eq.${accountId}`,
        limit: "1",
      }),
    );
    const account = accountResult.payload?.[0];
    if (!account || ["suspended", "deactivated"].includes(account.account_status)) {
      sendJson(res, 409, { ok: false, message: "This portal account is not eligible for access." });
      return;
    }
    const email = normaliseEmail(account.login_email);
    if (!allowedRecipients().has(email)) {
      sendJson(res, 403, {
        ok: false,
        message: "Staging email delivery is restricted to Huve and Jaryd.",
      });
      return;
    }
    if (!/^https:\/\//.test(redirectUrl())) {
      throw new Error("host_portal_redirect_missing");
    }

    const client = createClient(supabaseUrl(), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let userId = account.auth_user_id;
    let delivery = "invite";
    if (!userId) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirectUrl(),
        data: { company_id: account.company_id, account_type: "golf_host" },
      });
      if (error) throw error;
      userId = data.user?.id;
      if (!userId) throw new Error("invited_user_missing");
    } else {
      delivery = "password_setup";
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl(),
      });
      if (error) throw error;
    }

    const now = new Date().toISOString();
    const updated = await serviceRest(
      "host_accounts",
      query({ select: "id,login_email,auth_user_id,account_status,invited_at,last_access_sent_at", id: `eq.${accountId}` }),
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({
          auth_user_id: userId,
          account_status: "invited",
          invited_at: account.invited_at || now,
          last_access_sent_at: now,
        }),
      },
    );
    await auditAdmin(admin, "host_access_sent", "host_account", accountId, {
      after: updated.payload?.[0] || { login_email: email, account_status: "invited" },
      metadata: { delivery, recipient: email },
    });
    sendJson(res, 200, {
      ok: true,
      recipient: email,
      companyName: account.host_companies?.company_name || "Host company",
      delivery,
    });
  } catch (error) {
    console.error("[M2M Invitational] host access release failed", {
      admin: admin.email,
      code: error?.code || error?.name || "host_access_failed",
    });
    sendJson(res, 503, {
      ok: false,
      message: "Access could not be sent. No plaintext password was created or stored.",
    });
  }
}

export const config = { maxDuration: 30 };
