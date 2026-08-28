import { serviceRest } from "./_host-store.js";

export async function auditAdmin(admin, action, entityType, entityId, details = {}) {
  await serviceRest("admin_audit_log", "", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([
      {
        administrator_id: admin.id,
        administrator_email: admin.email,
        action,
        entity_type: entityType,
        entity_id: String(entityId || "") || null,
        before_data: details.before || null,
        after_data: details.after || null,
        metadata: details.metadata || {},
      },
    ]),
  });
}

export function uuidValue(value) {
  const string = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    string,
  )
    ? string
    : null;
}

