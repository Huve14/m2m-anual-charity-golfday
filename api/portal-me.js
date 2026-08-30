import { portalSession, sendPortalJson } from "./_portal-auth.js";
import { userRest } from "./_host-store.js";

function query(parameters) {
  return new URLSearchParams(parameters).toString();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendPortalJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  const session = await portalSession(req, res);
  if (!session) {
    sendPortalJson(res, 401, { ok: false, message: "Host sign-in required." });
    return;
  }
  try {
    const result = await userRest(
      session.accessToken,
      "host_accounts",
      query({
        select:
          "id,login_email,account_status,company:host_companies(id,company_reference,company_name,contact_first_name,contact_surname,contact_email,mobile,bookings:host_bookings(id,booking_reference,status,event:golf_events(id,name,venue,event_date,shotgun_start,portal_open,roster_editable,portal_message),allocations:booking_allocations(id,allocation_type,allocation_number,hole_number,status,price_zar,package:package_catalog(code,display_name),players:fourball_players(id,slot_number,first_name,surname,email,mobile,handicap,dietary_requirement,dietary_other,accessibility_notes,admin_notes,popia_acknowledged_at,updated_at))))",
        auth_user_id: `eq.${session.user.id}`,
        limit: "1",
      }),
    );
    const account = result.payload?.[0];
    if (!account || !["invited", "active"].includes(account.account_status)) {
      sendPortalJson(res, 403, { ok: false, message: "Portal access is not active for this company." });
      return;
    }
    sendPortalJson(res, 200, { ok: true, account });
  } catch (error) {
    console.error("[M2M Invitational] portal data load failed", {
      userId: session.user?.id,
      code: error?.code || "portal_data_failed",
    });
    sendPortalJson(res, 503, { ok: false, message: "Your host portal could not be loaded right now." });
  }
}

export const config = { maxDuration: 20 };

