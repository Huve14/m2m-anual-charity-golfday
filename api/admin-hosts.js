import { createClient } from "@supabase/supabase-js";
import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";
import { auditAdmin, uuidValue } from "./_host-admin.js";
import { normaliseEmail, serviceKey, serviceRest, supabaseUrl } from "./_host-store.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function query(parameters) {
  return new URLSearchParams(parameters).toString();
}

function bodyValue(req) {
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

function singleRelation(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function listHosts(req, res, admin) {
  try {
    const search = String(req.query?.search || "").trim().slice(0, 100);
    const parameters = {
      select:
        "id,company_reference,company_name,contact_first_name,contact_surname,contact_email,mobile,internal_notes,is_active,created_at,updated_at,host_accounts(id,login_email,auth_user_id,account_status,invited_at,last_access_sent_at,suspended_at),host_bookings(id,booking_reference,status,event_id,golf_events(name,venue,event_date,shotgun_start),booking_allocations(id,allocation_type,allocation_number,hole_number,status,price_zar,package_catalog(code,display_name),fourball_players(id,slot_number,first_name,surname,email,mobile,handicap,dietary_requirement,dietary_other,accessibility_notes,admin_notes,updated_at)))",
      order: "company_name.asc",
    };
    if (search) parameters.or = `(company_name.ilike.*${search.replace(/[(),]/g, "")}*,contact_email.ilike.*${search.replace(/[(),]/g, "")}*)`;
    const { payload } = await serviceRest("host_companies", query(parameters));
    sendJson(res, 200, { ok: true, hosts: Array.isArray(payload) ? payload : [] });
  } catch (error) {
    console.error("[M2M Invitational] host list failed", {
      admin: admin.email,
      code: error?.code || "host_list_failed",
    });
    sendJson(res, 503, { ok: false, message: "Host companies could not be loaded right now." });
  }
}

async function updateHost(req, res, admin) {
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  try {
    const body = bodyValue(req);
    const id = uuidValue(body?.id);
    const action = String(body?.action || "");
    if (!id) {
      sendJson(res, 400, { ok: false, message: "Select a valid host company." });
      return;
    }
    const existingResult = await serviceRest(
      "host_companies",
      query({
        select: "*,host_accounts(id,auth_user_id,login_email,account_status)",
        id: `eq.${id}`,
        limit: "1",
      }),
    );
    const existing = existingResult.payload?.[0];
    if (!existing) {
      sendJson(res, 404, { ok: false, message: "This host company no longer exists." });
      return;
    }

    if (action === "edit") {
      const contactEmail = normaliseEmail(body.contactEmail);
      const changes = {
        company_reference: String(body.companyReference || "").trim() || null,
        company_name: String(body.companyName || "").trim(),
        contact_first_name: String(body.contactFirstName || "").trim(),
        contact_surname: String(body.contactSurname || "").trim(),
        contact_email: contactEmail,
        mobile: String(body.mobile || "").trim(),
        internal_notes: String(body.internalNotes || "").trim() || null,
      };
      if (
        !changes.company_name ||
        !changes.contact_first_name ||
        !changes.contact_surname ||
        !EMAIL_PATTERN.test(contactEmail) ||
        changes.mobile.length < 7
      ) {
        sendJson(res, 400, { ok: false, message: "Enter complete, valid company contact details." });
        return;
      }
      const existingAccount = singleRelation(existing.host_accounts);
      let authEmailChanged = false;
      if (
        existingAccount?.auth_user_id &&
        contactEmail !== normaliseEmail(existingAccount.login_email)
      ) {
        const client = createClient(supabaseUrl(), serviceKey(), {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await client.auth.admin.updateUserById(existingAccount.auth_user_id, {
          email: contactEmail,
          email_confirm: true,
        });
        if (error) throw error;
        authEmailChanged = true;
      }
      let result;
      try {
        result = await serviceRest(
          "host_companies",
          query({ select: "*", id: `eq.${id}` }),
          {
            method: "PATCH",
            prefer: "return=representation",
            body: JSON.stringify(changes),
          },
        );
        await serviceRest("host_accounts", query({ company_id: `eq.${id}` }), {
          method: "PATCH",
          prefer: "return=minimal",
          body: JSON.stringify({ login_email: contactEmail }),
        });
      } catch (error) {
        if (authEmailChanged) {
          const client = createClient(supabaseUrl(), serviceKey(), {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          await client.auth.admin.updateUserById(existingAccount.auth_user_id, {
            email: existingAccount.login_email,
            email_confirm: true,
          });
        }
        throw error;
      }
      await auditAdmin(admin, "host_company_updated", "host_company", id, {
        before: existing,
        after: result.payload?.[0] || changes,
      });
      sendJson(res, 200, { ok: true, host: result.payload?.[0] });
      return;
    }

    if (["suspend", "restore"].includes(action)) {
      const currentAccountResult = await serviceRest(
        "host_accounts",
        query({ select: "auth_user_id", company_id: `eq.${id}`, limit: "1" }),
      );
      const accountStatus = action === "suspend"
        ? "suspended"
        : currentAccountResult.payload?.[0]?.auth_user_id
          ? "active"
          : "pending_review";
      const accountResult = await serviceRest(
        "host_accounts",
        query({ select: "id,account_status,suspended_at", company_id: `eq.${id}` }),
        {
          method: "PATCH",
          prefer: "return=representation",
          body: JSON.stringify({
            account_status: accountStatus,
            suspended_at: action === "suspend" ? new Date().toISOString() : null,
          }),
        },
      );
      await auditAdmin(admin, `host_access_${action}d`, "host_company", id, {
        after: accountResult.payload?.[0] || { account_status: accountStatus },
      });
      sendJson(res, 200, { ok: true, account: accountResult.payload?.[0] });
      return;
    }

    sendJson(res, 400, { ok: false, message: "Choose a valid host action." });
  } catch (error) {
    const duplicate = error?.code === "23505";
    console.error("[M2M Invitational] host update failed", {
      admin: admin.email,
      code: error?.code || "host_update_failed",
    });
    sendJson(res, duplicate ? 409 : 503, {
      ok: false,
      message: duplicate
        ? "That company reference or login email is already in use."
        : "The host company could not be updated right now.",
    });
  }
}

async function deleteHost(req, res, admin) {
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  try {
    const id = uuidValue(req.query?.id);
    if (!id || String(req.query?.confirmed || "") !== "true") {
      sendJson(res, 400, { ok: false, message: "Confirm a valid host company deletion." });
      return;
    }
    const current = await serviceRest(
      "host_companies",
      query({
        select: "*,host_accounts(id,auth_user_id,login_email,account_status)",
        id: `eq.${id}`,
        limit: "1",
      }),
    );
    const host = current.payload?.[0];
    if (!host) {
      sendJson(res, 404, { ok: false, message: "This host company no longer exists." });
      return;
    }
    const hostAccount = singleRelation(host.host_accounts);
    const authUserId = hostAccount?.auth_user_id;
    if (authUserId) {
      const client = createClient(supabaseUrl(), serviceKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.admin.deleteUser(authUserId);
      if (error) throw error;
    }
    await serviceRest("host_companies", query({ id: `eq.${id}` }), {
      method: "DELETE",
      prefer: "return=minimal",
    });
    await auditAdmin(admin, "host_company_deleted", "host_company", id, {
      before: {
        company_name: host.company_name,
        contact_email: host.contact_email,
        account_status: hostAccount?.account_status || null,
      },
    });
    sendJson(res, 200, { ok: true, deletedHost: { id, companyName: host.company_name } });
  } catch (error) {
    console.error("[M2M Invitational] host deletion failed", {
      admin: admin.email,
      code: error?.code || "host_delete_failed",
    });
    sendJson(res, 503, { ok: false, message: "The host company could not be deleted safely." });
  }
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method === "GET") return listHosts(req, res, admin);
  if (req.method === "PATCH") return updateHost(req, res, admin);
  if (req.method === "DELETE") return deleteHost(req, res, admin);
  res.setHeader("Allow", "GET, PATCH, DELETE");
  sendJson(res, 405, { ok: false, message: "Method not allowed." });
}

export const config = { maxDuration: 30 };
