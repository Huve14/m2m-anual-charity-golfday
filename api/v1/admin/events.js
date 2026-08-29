import { z } from "zod";
import {
  adminClient,
  fromSupabase,
  parseJsonBody,
  recordAudit,
  requireAdmin,
  sendError,
  sendJson,
  validate,
} from "../../_ops.js";

const optionalDate = z.union([z.string().datetime({ offset: true }), z.literal(""), z.null()]).optional();
const eventSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  venueName: z.string().trim().max(180).default(""),
  venueAddress: z.string().trim().max(500).default(""),
  format: z.string().trim().min(2).max(120).default("Better Ball"),
  timezone: z.string().trim().min(2).max(80).default("Africa/Johannesburg"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("ZAR"),
  shotgunStartAt: optionalDate,
  registrationDeadlineAt: optionalDate,
  playerDeadlineAt: optionalDate,
  rules: z.string().trim().max(20_000).default(""),
  primaryColour: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#0C1735"),
  accentColour: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#ED1C24"),
  requiredPlayerFields: z.array(z.enum([
    "full_name", "email", "phone", "handicap", "shirt_size", "dietary_requirements",
    "special_requirements", "home_club", "golf_id",
  ])).default(["full_name", "email", "phone", "handicap", "shirt_size"]),
  shirtSizeOptions: z.array(z.string().trim().min(1).max(20)).min(1).default(["XS", "S", "M", "L", "XL", "2XL", "3XL"]),
  reminderOffsetsDays: z.array(z.number().int().min(1).max(90)).max(8).default([14, 7, 2]),
  holeCount: z.number().int().min(1).max(36).default(18),
  slotsPerHole: z.number().int().min(1).max(4).default(2),
});

const patchSchema = eventSchema.partial().omit({ holeCount: true, slotsPerHole: true }).extend({
  id: z.string().uuid(),
  action: z.enum(["update", "activate", "archive", "complete", "restoreDraft"]).default("update"),
  logoPath: z.string().trim().max(500).nullable().optional(),
  bannerPath: z.string().trim().max(500).nullable().optional(),
});

function row(input) {
  const nullableDate = (value) => value === undefined ? undefined : value || null;
  return {
    name: input.name,
    slug: input.slug,
    venue_name: input.venueName,
    venue_address: input.venueAddress,
    format: input.format,
    timezone: input.timezone,
    currency: input.currency,
    shotgun_start_at: nullableDate(input.shotgunStartAt),
    registration_deadline_at: nullableDate(input.registrationDeadlineAt),
    player_deadline_at: nullableDate(input.playerDeadlineAt),
    rules: input.rules,
    primary_colour: input.primaryColour,
    accent_colour: input.accentColour,
    required_player_fields: input.requiredPlayerFields,
    shirt_size_options: input.shirtSizeOptions,
    reminder_offsets_days: input.reminderOffsetsDays,
  };
}

function publicEvent(event) {
  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    status: event.status,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    format: event.format,
    timezone: event.timezone,
    currency: event.currency,
    shotgunStartAt: event.shotgun_start_at,
    registrationDeadlineAt: event.registration_deadline_at,
    playerDeadlineAt: event.player_deadline_at,
    rules: event.rules,
    primaryColour: event.primary_colour,
    accentColour: event.accent_colour,
    logoPath: event.logo_path,
    bannerPath: event.banner_path,
    requiredPlayerFields: event.required_player_fields || [],
    shirtSizeOptions: event.shirt_size_options || [],
    reminderOffsetsDays: event.reminder_offsets_days || [],
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
}

async function list(req, res) {
  await requireAdmin(req);
  const id = typeof req.query?.id === "string" ? req.query.id : "";
  let query = adminClient().from("m2m_events").select("*").order("shotgun_start_at", { ascending: false, nullsFirst: false });
  if (id) query = query.eq("id", id);
  const { data, error } = await query;
  if (error) throw fromSupabase(error, "events_load_failed", "Events could not be loaded.");
  if (id && !data?.[0]) {
    sendJson(res, 404, { ok: false, code: "event_not_found", message: "This event no longer exists." });
    return;
  }
  sendJson(res, 200, { ok: true, ...(id ? { event: publicEvent(data[0]) } : { events: data.map(publicEvent) }) });
}

async function create(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(eventSchema, parseJsonBody(req));
  const client = adminClient();
  const { data: event, error } = await client
    .from("m2m_events")
    .insert({ ...row(input), created_by: profile.id })
    .select("*")
    .single();
  if (error) throw fromSupabase(error, "event_create_failed", "The event could not be created.");

  try {
    const holes = Array.from({ length: input.holeCount }, (_, index) => ({
      event_id: event.id,
      hole_number: index + 1,
      label: `Hole ${index + 1}`,
      sort_order: index + 1,
    }));
    const { data: createdHoles, error: holeError } = await client.from("m2m_event_holes").insert(holes).select("id,event_id,hole_number");
    if (holeError) throw holeError;
    const labels = ["A", "B", "C", "D"];
    const teeSlots = createdHoles.flatMap((hole) =>
      labels.slice(0, input.slotsPerHole).map((label, index) => ({
        event_id: event.id,
        hole_id: hole.id,
        slot_label: label,
        sort_order: hole.hole_number * 10 + index,
      })),
    );
    const sponsorSlots = createdHoles.map((hole) => ({
      event_id: event.id,
      hole_id: hole.id,
      label: "Primary sponsor",
      sort_order: hole.hole_number,
    }));
    const [{ error: teeError }, { error: sponsorError }] = await Promise.all([
      client.from("m2m_tee_slots").insert(teeSlots),
      client.from("m2m_hole_sponsorship_slots").insert(sponsorSlots),
    ]);
    if (teeError || sponsorError) throw teeError || sponsorError;
  } catch (setupError) {
    await client.from("m2m_events").delete().eq("id", event.id);
    throw fromSupabase(setupError, "event_setup_failed", "The event course could not be created.");
  }

  await recordAudit({ eventId: event.id, actorId: profile.id, action: "event.created", entityType: "event", entityId: event.id });
  sendJson(res, 201, { ok: true, event: publicEvent(event) });
}

async function update(req, res) {
  const profile = await requireAdmin(req);
  const input = validate(patchSchema, parseJsonBody(req));
  const client = adminClient();
  if (input.action === "activate") {
    const { error } = await client.rpc("m2m_activate_event", { p_event_id: input.id, p_actor_id: profile.id });
    if (error) throw fromSupabase(error, "event_activate_failed", "The event could not be activated.");
  } else if (input.action !== "update") {
    const status = { archive: "archived", complete: "completed", restoreDraft: "draft" }[input.action];
    const { error } = await client.from("m2m_events").update({ status }).eq("id", input.id);
    if (error) throw fromSupabase(error, "event_status_failed", "The event status could not be changed.");
    await recordAudit({ eventId: input.id, actorId: profile.id, action: `event.${status}`, entityType: "event", entityId: input.id });
  } else {
    const allowed = row({
      name: input.name,
      slug: input.slug,
      venueName: input.venueName,
      venueAddress: input.venueAddress,
      format: input.format,
      timezone: input.timezone,
      currency: input.currency,
      shotgunStartAt: input.shotgunStartAt,
      registrationDeadlineAt: input.registrationDeadlineAt,
      playerDeadlineAt: input.playerDeadlineAt,
      rules: input.rules,
      primaryColour: input.primaryColour,
      accentColour: input.accentColour,
      requiredPlayerFields: input.requiredPlayerFields,
      shirtSizeOptions: input.shirtSizeOptions,
      reminderOffsetsDays: input.reminderOffsetsDays,
    });
    const changes = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
    if (input.logoPath !== undefined) changes.logo_path = input.logoPath;
    if (input.bannerPath !== undefined) changes.banner_path = input.bannerPath;
    const { error } = await client.from("m2m_events").update(changes).eq("id", input.id);
    if (error) throw fromSupabase(error, "event_update_failed", "The event could not be updated.");
    await recordAudit({ eventId: input.id, actorId: profile.id, action: "event.updated", entityType: "event", entityId: input.id, metadata: { fields: Object.keys(changes) } });
  }
  const { data, error } = await client.from("m2m_events").select("*").eq("id", input.id).single();
  if (error) throw fromSupabase(error, "event_load_failed");
  sendJson(res, 200, { ok: true, event: publicEvent(data) });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await list(req, res);
    if (req.method === "POST") return await create(req, res);
    if (req.method === "PATCH") return await update(req, res);
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
  } catch (error) {
    sendError(res, error, "The event request failed.");
  }
}

export const config = { maxDuration: 30 };
