import { z } from "zod";
import { adminClient, ensureContactProfile, fromSupabase, parseJsonBody, recordAudit, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const createSchema = z.object({
  eventId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(180).optional(),
  registrationNumber: z.string().trim().max(80).optional(),
  website: z.string().trim().max(300).optional(),
  billingEmail: z.union([z.string().email(), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
  relationshipStatus: z.enum(["prospect", "pending", "confirmed", "cancelled"]).default("prospect"),
  primaryContactName: z.string().trim().max(160).optional(),
  primaryContactEmail: z.union([z.string().email(), z.literal("")]).optional(),
  primaryContactPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(5000).optional(),
}).refine((value) => value.companyId || value.name, { message: "Choose or name a company.", path: ["name"] })
  .refine((value) => Boolean(value.primaryContactName) === Boolean(value.primaryContactEmail), { message: "Enter both the primary contact name and email.", path: ["primaryContactEmail"] });

const updateSchema = createSchema.partial().extend({ id: z.string().uuid(), eventId: z.string().uuid() });

function shape(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    companyId: row.company_id,
    name: row.company?.name || "",
    registrationNumber: row.company?.registration_number || "",
    website: row.company?.website || "",
    billingEmail: row.company?.billing_email || "",
    phone: row.company?.phone || "",
    relationshipStatus: row.relationship_status,
    primaryContactName: row.primary_contact_name || "",
    primaryContactEmail: row.primary_contact_email || "",
    primaryContactPhone: row.primary_contact_phone || "",
    primaryContactProfileId: row.primary_contact_profile_id || null,
    notes: row.notes || "",
  };
}

async function list(req, res) {
  await requireAdmin(req);
  const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
  const client = adminClient();
  const [linked, directory] = await Promise.all([
    client.from("m2m_event_companies").select("*,company:m2m_companies(*)").eq("event_id", eventId).order("created_at"),
    client.from("m2m_companies").select("id,name,registration_number,website,billing_email,phone").order("name"),
  ]);
  if (linked.error || directory.error) throw fromSupabase(linked.error || directory.error, "companies_load_failed", "Companies could not be loaded.");
  sendJson(res, 200, { ok: true, companies: linked.data.map(shape), directory: directory.data.map((item) => ({
    id: item.id, name: item.name, registrationNumber: item.registration_number || "", website: item.website || "",
    billingEmail: item.billing_email || "", phone: item.phone || "",
  })) });
}

async function create(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(createSchema, parseJsonBody(req));
  const client = adminClient();
  const contactProfile = await ensureContactProfile({ email: input.primaryContactEmail, fullName: input.primaryContactName });
  let companyId = input.companyId;
  if (!companyId) {
    const { data, error } = await client.from("m2m_companies").insert({
      name: input.name,
      registration_number: input.registrationNumber || null,
      website: input.website || null,
      billing_email: input.billingEmail || null,
      phone: input.phone || null,
      created_by: profile.id,
    }).select("id").single();
    if (error) throw fromSupabase(error, "company_create_failed", "The company could not be created.");
    companyId = data.id;
  }
  const { data, error } = await client.from("m2m_event_companies").insert({
    event_id: input.eventId,
    company_id: companyId,
    relationship_status: input.relationshipStatus,
    primary_contact_name: input.primaryContactName || null,
    primary_contact_email: input.primaryContactEmail || null,
    primary_contact_phone: input.primaryContactPhone || null,
    primary_contact_profile_id: contactProfile?.id || null,
    notes: input.notes || null,
  }).select("*,company:m2m_companies(*)").single();
  if (error) throw fromSupabase(error, "company_link_failed", "The company could not be added to this event.");
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "company.added", entityType: "event_company", entityId: data.id });
  sendJson(res, 201, { ok: true, company: shape(data) });
}

async function update(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(updateSchema, parseJsonBody(req));
  const client = adminClient();
  const { data: linkedCompany, error: linkedCompanyError } = await client
    .from("m2m_event_companies")
    .select("company_id")
    .eq("id", input.id)
    .eq("event_id", input.eventId)
    .single();
  if (linkedCompanyError) throw fromSupabase(linkedCompanyError, "company_not_found", "The company could not be found in this event.");

  const companyChanges = {};
  if (input.name !== undefined) companyChanges.name = input.name;
  if (input.registrationNumber !== undefined) companyChanges.registration_number = input.registrationNumber || null;
  if (input.website !== undefined) companyChanges.website = input.website || null;
  if (input.billingEmail !== undefined) companyChanges.billing_email = input.billingEmail || null;
  if (input.phone !== undefined) companyChanges.phone = input.phone || null;
  if (Object.keys(companyChanges).length) {
    const { error } = await client.from("m2m_companies").update(companyChanges).eq("id", linkedCompany.company_id);
    if (error) throw fromSupabase(error, "company_directory_update_failed", "The company details could not be updated.");
  }

  const changes = {};
  if (input.relationshipStatus !== undefined) changes.relationship_status = input.relationshipStatus;
  if (input.primaryContactName !== undefined) changes.primary_contact_name = input.primaryContactName || null;
  if (input.primaryContactEmail !== undefined) changes.primary_contact_email = input.primaryContactEmail || null;
  if (input.primaryContactPhone !== undefined) changes.primary_contact_phone = input.primaryContactPhone || null;
  if (input.primaryContactName !== undefined || input.primaryContactEmail !== undefined) {
    const contactProfile = await ensureContactProfile({ email: input.primaryContactEmail, fullName: input.primaryContactName });
    changes.primary_contact_profile_id = contactProfile?.id || null;
  }
  if (input.notes !== undefined) changes.notes = input.notes || null;
  let query = client.from("m2m_event_companies").select("*,company:m2m_companies(*)").eq("id", input.id).eq("event_id", input.eventId);
  if (Object.keys(changes).length) query = client.from("m2m_event_companies").update(changes).eq("id", input.id).eq("event_id", input.eventId).select("*,company:m2m_companies(*)");
  const { data, error } = await query.single();
  if (error) throw fromSupabase(error, "company_update_failed", "The company could not be updated.");
  await recordAudit({ eventId: input.eventId, actorId: profile.id, action: "company.updated", entityType: "event_company", entityId: input.id, metadata: { fields: [...Object.keys(companyChanges), ...Object.keys(changes)] } });
  sendJson(res, 200, { ok: true, company: shape(data) });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST") return await create(req, res);
    if (req.method === "PATCH") return await update(req, res);
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The company request failed.");
  }
}

export const config = { maxDuration: 30 };
