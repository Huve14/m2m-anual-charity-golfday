const col = (name, width = 30) => ({ name, width });
const label = (value) => String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const value = (entry) => Array.isArray(entry) ? entry.map(label).join(", ") : entry ?? "";

export function pageSheets(data, type, event) {
  if (type === "overview") return [
    { name: "Overview", title: "Event overview", columns: [col("Metric", 42), col("Value", 20)], rows: Object.entries(data.metrics || {}).map(([key, entry]) => [label(key), entry]) },
    { name: "Readiness", title: "Event readiness", columns: [col("Check", 30), col("Details", 60)], rows: [["Ready to activate", data.setup?.readyToActivate ? "Yes" : "No"], ...(data.setup?.blockers || []).map((item) => ["Missing required setup", item]), ...(data.setup?.warnings || []).map((item) => ["Recommended setup", item])] },
  ];
  if (type === "setup") {
    const fields = ["name", "status", "venue_name", "venue_address", "format", "timezone", "currency", "shotgun_start_at", "registration_deadline_at", "player_deadline_at", "rules", "primary_colour", "accent_colour", "visible_player_fields", "required_player_fields", "shirt_size_options", "reminder_offsets_days"];
    return [
      { name: "Event setup", title: "Event setup", note: "Saved event settings. Dates are shown in ISO format with their UTC offset.", columns: [col("Setting", 36), col("Value", 90)], rows: fields.map((key) => [label(key), value(event[key])]) },
      { name: "Course holes", title: "Course holes", columns: [col("Hole number", 18), col("Label"), col("Par", 12)], rows: [...(data.holes || [])].sort((a, b) => a.sort_order - b.sort_order).map((hole) => [hole.hole_number, hole.label, hole.par]) },
    ];
  }
  return [
    { name: "Tee sheet", title: "Tee sheet", note: "All tee positions, including open slots.", columns: [col("Hole"), col("Start position"), col("Company"), col("Team"), col("Booking status")], rows: [...(data.tee || [])].sort((a, b) => (a.hole?.hole_number || 0) - (b.hole?.hole_number || 0) || a.sort_order - b.sort_order).map((slot) => [slot.hole?.label, slot.slot_label, slot.fourball?.eventCompany?.company?.name, slot.fourball?.team_name || "Open", slot.fourball?.booking_status || ""]) },
    { name: "Unassigned teams", title: "Teams without a tee position", columns: [col("Company"), col("Team"), col("Booking status")], rows: (data.fourballs || []).filter((team) => !(Array.isArray(team.tee) ? team.tee.length : team.tee) && team.booking_status !== "cancelled").map((team) => [team.eventCompany?.company?.name, team.team_name, team.booking_status]) },
  ];
}
