import { z } from "zod";
import { adminClient, fromSupabase, parseJsonBody, requireAdmin, sendError, sendJson, validate } from "../../_ops.js";

const companySchema = z.object({
  companyName: z.string().trim().min(2).max(180),
  contactName: z.string().trim().max(160).default(""),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
  fourballQuantity: z.number().int().min(0).max(100),
  sponsorshipConfirmed: z.boolean(),
});

const commitSchema = z.object({
  eventId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  fourballTypeId: z.string().uuid(),
  sponsorshipTypeId: z.string().uuid().nullable(),
  companies: z.array(companySchema).min(1).max(500),
}).superRefine((input, context) => {
  if (input.companies.some((company) => company.sponsorshipConfirmed) && !input.sponsorshipTypeId) {
    context.addIssue({ code: "custom", path: ["sponsorshipTypeId"], message: "Select the sponsorship type for confirmed sponsors." });
  }
  const names = new Set();
  input.companies.forEach((company, index) => {
    const key = company.companyName.toLowerCase().replace(/\s+/g, " ");
    if (names.has(key)) context.addIssue({ code: "custom", path: ["companies", index, "companyName"], message: "Duplicate consolidated company." });
    names.add(key);
  });
});

async function list(req, res) {
  await requireAdmin(req);
  const eventId = typeof req.query?.eventId === "string" ? req.query.eventId : "";
  const client = adminClient();
  const [fourballTypes, sponsorshipTypes, batches] = await Promise.all([
    client.from("m2m_fourball_types").select("id,name,capacity,price_minor,is_active").eq("event_id", eventId).eq("is_active", true).order("sort_order"),
    client.from("m2m_sponsorship_types").select("id,name,capacity,price_minor,requires_hole,is_active").eq("event_id", eventId).eq("is_active", true).order("sort_order"),
    client.from("m2m_confirmed_import_batches").select("id,file_name,file_sha256,company_count,fourball_count,sponsorship_count,summary,created_at").eq("event_id", eventId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (fourballTypes.error || sponsorshipTypes.error || batches.error) throw fromSupabase(fourballTypes.error || sponsorshipTypes.error || batches.error, "confirmed_import_setup_failed", "Import setup could not be loaded.");
  sendJson(res, 200, {
    ok: true,
    fourballTypes: fourballTypes.data.map((item) => ({ id: item.id, name: item.name, capacity: item.capacity, priceMinor: item.price_minor })),
    sponsorshipTypes: sponsorshipTypes.data.map((item) => ({ id: item.id, name: item.name, capacity: item.capacity, priceMinor: item.price_minor, requiresHole: item.requires_hole })),
    batches: batches.data.map((item) => ({ id: item.id, fileName: item.file_name, fileSha256: item.file_sha256, companyCount: item.company_count, fourballCount: item.fourball_count, sponsorshipCount: item.sponsorship_count, summary: item.summary, createdAt: item.created_at })),
  });
}

async function commit(req, res) {
  const actor = await requireAdmin(req);
  const input = validate(commitSchema, parseJsonBody(req, 500_000));
  const { data, error } = await adminClient().rpc("m2m_import_confirmed_companies", {
    p_event_id: input.eventId,
    p_file_name: input.fileName,
    p_file_sha256: input.fileSha256,
    p_companies: input.companies,
    p_fourball_type_id: input.fourballTypeId,
    p_sponsorship_type_id: input.sponsorshipTypeId,
    p_actor_id: actor.id,
  });
  if (error) throw fromSupabase(error, "confirmed_import_failed", "The confirmed list could not be imported.");
  sendJson(res, 201, { ok: true, result: data });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST") return await commit(req, res);
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) { sendError(res, error, "The confirmed-list request failed."); }
}

export const config = { maxDuration: 30 };
