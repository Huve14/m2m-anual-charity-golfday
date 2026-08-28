import { isSameOrigin } from "./_admin-auth.js";
import { portalSession, sendPortalJson } from "./_portal-auth.js";
import { userRpc } from "./_host-store.js";

const DIETARY_OPTIONS = new Set([
  "None",
  "Vegetarian",
  "Vegan",
  "Halaal",
  "Kosher",
  "Gluten-free",
  "Other",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function normalisePlayers(players) {
  if (!Array.isArray(players) || players.length !== 4) throw new Error("four_slots_required");
  const slots = new Set();
  return players.map((player) => {
    const slotNumber = Number(player?.slotNumber);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 4 || slots.has(slotNumber)) {
      throw new Error("invalid_player_slot");
    }
    slots.add(slotNumber);
    const email = text(player?.email, 254).toLowerCase();
    const dietaryRequirement = text(player?.dietaryRequirement || "None", 30);
    if (email && !EMAIL_PATTERN.test(email)) throw new Error("invalid_player_email");
    if (!DIETARY_OPTIONS.has(dietaryRequirement)) throw new Error("invalid_dietary_option");
    const dietaryOther =
      dietaryRequirement === "Other" ? text(player?.dietaryOther, 300) : "";
    if (dietaryRequirement === "Other" && !dietaryOther) throw new Error("dietary_other_required");
    return {
      slotNumber,
      firstName: text(player?.firstName, 100),
      surname: text(player?.surname, 100),
      email,
      mobile: text(player?.mobile, 40),
      handicap: text(player?.handicap, 30),
      dietaryRequirement,
      dietaryOther,
      accessibilityNotes: text(player?.accessibilityNotes, 1000),
      adminNotes: text(player?.adminNotes, 1000),
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    sendPortalJson(res, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!isSameOrigin(req)) {
    sendPortalJson(res, 403, { ok: false, message: "Request not allowed." });
    return;
  }
  const session = await portalSession(req, res);
  if (!session) {
    sendPortalJson(res, 401, { ok: false, message: "Host sign-in required." });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const allocationId = String(req.query?.id || body?.allocationId || "");
    if (!UUID_PATTERN.test(allocationId) || body?.popiaAcknowledged !== true) {
      sendPortalJson(res, 400, {
        ok: false,
        message: "Confirm the POPIA acknowledgement before saving player details.",
      });
      return;
    }
    const players = normalisePlayers(body.players);
    const result = await userRpc(session.accessToken, "m2m_save_fourball_players", {
      p_allocation_id: allocationId,
      p_players: players,
      p_popia_acknowledged: true,
    });
    sendPortalJson(res, 200, {
      ok: true,
      result,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    const validation = new Set([
      "four_slots_required",
      "invalid_player_slot",
      "invalid_player_email",
      "invalid_dietary_option",
      "dietary_other_required",
    ]).has(error?.message);
    console.error("[M2M Invitational] player roster save failed", {
      userId: session.user?.id,
      code: error?.code || error?.message || "player_save_failed",
    });
    sendPortalJson(res, validation ? 400 : 503, {
      ok: false,
      message: validation
        ? "Check all four player slots and any dietary ‘Other’ details."
        : "Player details could not be saved right now. Your unsaved changes remain on screen.",
    });
  }
}

export const config = { maxDuration: 20 };
