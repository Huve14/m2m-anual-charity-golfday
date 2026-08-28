import { isSameOrigin, requireAdmin, sendJson } from "./_admin-auth.js";
import { auditAdmin, uuidValue } from "./_host-admin.js";
import { serviceRest } from "./_host-store.js";

function query(parameters) {
  return new URLSearchParams(parameters).toString();
}

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
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
    const id = uuidValue(req.query?.id || body?.id);
    const holeNumber = body?.holeNumber === null || body?.holeNumber === "" ? null : Number(body?.holeNumber);
    if (!id || (holeNumber !== null && (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18))) {
      sendJson(res, 400, { ok: false, message: "Choose a valid sponsorship allocation and hole." });
      return;
    }
    const beforeResult = await serviceRest(
      "booking_allocations",
      query({ select: "id,allocation_type,hole_number,status", id: `eq.${id}`, limit: "1" }),
    );
    const before = beforeResult.payload?.[0];
    if (!before || before.allocation_type !== "hole_sponsorship") {
      sendJson(res, 404, { ok: false, message: "This sponsorship allocation no longer exists." });
      return;
    }
    const result = await serviceRest(
      "booking_allocations",
      query({ select: "id,hole_number,status,updated_at", id: `eq.${id}` }),
      {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ hole_number: holeNumber }),
      },
    );
    await auditAdmin(admin, "hole_assignment_updated", "booking_allocation", id, {
      before,
      after: result.payload?.[0] || { hole_number: holeNumber },
    });
    sendJson(res, 200, { ok: true, allocation: result.payload?.[0] });
  } catch (error) {
    const conflict = error?.code === "23505";
    console.error("[M2M Invitational] hole assignment failed", {
      admin: admin.email,
      code: error?.code || "hole_assignment_failed",
    });
    sendJson(res, conflict ? 409 : 503, {
      ok: false,
      message: conflict
        ? "That hole is already assigned to another active sponsor."
        : "The hole assignment could not be updated right now.",
    });
  }
}
