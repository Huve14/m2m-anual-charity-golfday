import { fromSupabase } from "./_ops.js";

export const exportTypes = ["players", "fourballs", "sponsors", "suppliers", "hosts", "confirmations", "confirmed-companies", "confirmed-fourballs", "confirmed-sponsors", "confirmed-suppliers", "invoices"];

const companyJoin = "eventCompany:m2m_event_companies(id,relationship_status,primary_contact_name,primary_contact_email,primary_contact_phone,company:m2m_companies(name,billing_email))";
const fourballJoin = `fourball:m2m_fourballs(team_name,booking_status,submission_status,${companyJoin})`;
const sources = {
  companies: ["m2m_event_companies", "id,relationship_status,primary_contact_name,primary_contact_email,primary_contact_phone,notes,company:m2m_companies(name,billing_email,phone)"],
  fourballs: ["m2m_fourballs", `id,team_name,booking_status,submission_status,payment_status,confirmed_amount_minor,invoice_reference,notes,type:m2m_fourball_types(name),${companyJoin},tee:m2m_tee_slots(slot_label,hole:m2m_event_holes(label)),hosts:m2m_fourball_hosts(is_primary,profile:m2m_profiles(full_name,email))`],
  players: ["m2m_players", `id,position,full_name,email,phone,handicap,shirt_size,dietary_requirements,special_requirements,home_club,golf_id,${fourballJoin}`],
  hosts: ["m2m_fourball_hosts", `id,is_primary,invited_at,accepted_at,last_notified_at,profile:m2m_profiles(full_name,email),${fourballJoin}`],
  sponsors: ["m2m_sponsorship_commitments", `id,status,quantity,confirmed_amount_minor,payment_status,invoice_reference,contribution,prize_value_minor,notes,type:m2m_sponsorship_types(id,name,category),${companyJoin},units:m2m_sponsorship_units(unit_number,slot:m2m_hole_sponsorship_slots(label,location_name,hole:m2m_event_holes(label)))`],
  sponsorshipTypes: ["m2m_sponsorship_types", "id,name,category"],
};

// Page every source so exports never silently stop at the Data API row limit.
export async function loadExportData(client, eventId, type) {
  const names = type === "confirmations" ? Object.keys(sources)
    : type === "invoices" ? ["fourballs", "sponsors"]
    : type === "confirmed-sponsors" ? ["sponsors", "sponsorshipTypes"]
      : [type.replace("confirmed-", "").replace("suppliers", "sponsors")];
  const entries = await Promise.all(names.map(async (name) => {
    const [table, select] = sources[name];
    const rows = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from(table).select(select).eq("event_id", eventId).order("id").range(offset, offset + pageSize - 1);
      if (error) throw fromSupabase(error, "export_data_failed", "The export data could not be loaded.");
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    return [name, rows];
  }));
  return Object.fromEntries(entries);
}

const one = (value) => Array.isArray(value) ? value[0] : value;
const companyName = (row) => row.eventCompany?.company?.name || "";
const activeCompany = (row) => row.eventCompany?.relationship_status !== "cancelled";
const rand = (minor) => minor == null ? null : minor / 100;
const label = (value) => String(value || "").replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
const column = (name, width = 22, format) => ({ name, width, format });
const moneyColumn = (name) => column(name, 23, "money");
const textColumn = (name) => column(name, 40);
const dateColumn = (name) => column(name, 24, "date");
const byCompany = (rows) => rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])) || String(a[2]).localeCompare(String(b[2]), undefined, { numeric: true }));
const scope = (confirmed) => confirmed ? "Confirmed records only. Cancelled company participation is excluded." : "All statuses. Use the column filters to narrow this report.";

function companiesSheet(rows) {
  return { name: "Companies", title: "Confirmed companies", note: "Companies whose participation status is confirmed.", columns: [column("Company", 32), column("Status"), column("Primary contact", 28), textColumn("Contact email"), column("Contact phone"), textColumn("Billing email"), column("Company phone"), textColumn("Notes")], rows: byCompany(rows.map((row) => [row.company?.name, label(row.relationship_status), row.primary_contact_name, row.primary_contact_email, row.primary_contact_phone, row.company?.billing_email, row.company?.phone, row.notes])) };
}

function fourballsSheet(rows, confirmed) {
  return { name: "Fourballs", title: confirmed ? "Confirmed fourballs" : "Fourballs and tee sheet", note: scope(confirmed), columns: [column("Company", 32), column("Team", 30), column("Fourball type", 28), column("Booking"), column("Player submission"), column("Shotgun start", 26), column("Primary host", 28), textColumn("Host email"), moneyColumn("Booking amount"), column("Payment"), column("Invoice"), textColumn("Notes")], rows: byCompany(rows.map((row) => {
    const host = row.hosts?.find((entry) => entry.is_primary)?.profile;
    const tee = one(row.tee);
    return [companyName(row), row.team_name, row.type?.name, label(row.booking_status), label(row.submission_status), tee ? `${tee.hole?.label || ""} ${tee.slot_label}`.trim() : "Unassigned", host?.full_name, host?.email, rand(row.confirmed_amount_minor), label(row.payment_status), row.invoice_reference, row.notes];
  })) };
}

function playersSheet(rows, confirmed) {
  return { name: "Players", title: confirmed ? "Players in confirmed fourballs" : "Complete player list", note: scope(confirmed), columns: [column("Company", 32), column("Team", 30), column("Position", 12, "integer"), column("Player", 28), textColumn("Email"), column("Phone"), column("Handicap", 14), column("Shirt size", 14), textColumn("Dietary requirements"), textColumn("Special requirements"), column("Home club", 28), column("Golf ID")], rows: byCompany(rows.map((row) => [companyName(row.fourball || {}), row.fourball?.team_name, row.position, row.full_name, row.email, row.phone, row.handicap, row.shirt_size, row.dietary_requirements, row.special_requirements, row.home_club, row.golf_id])) };
}

function hostsSheet(rows, confirmed) {
  return { name: "Hosts", title: confirmed ? "Hosts of confirmed fourballs" : "Host invitation and submission report", note: scope(confirmed), columns: [column("Company", 32), column("Team", 30), column("Host", 28), textColumn("Email"), column("Primary host", 16), dateColumn("Invited"), dateColumn("Accepted"), dateColumn("Last reminder"), column("Player submission")], rows: byCompany(rows.map((row) => [companyName(row.fourball || {}), row.fourball?.team_name, row.profile?.full_name, row.profile?.email, row.is_primary ? "Yes" : "No", row.invited_at, row.accepted_at, row.last_notified_at, label(row.fourball?.submission_status)])) };
}

function sponsorsSheet(rows, confirmed, name = "Sponsorships", title = "Sponsorship commitments") {
  return { name, title, note: `${scope(confirmed)} One row per commitment; amounts and prize values are contribution totals, not per unit.`, columns: [column("Company", 32), column("Sponsorship type", 30), column("Category", 26), column("Status", 16), column("Quantity", 14, "integer"), textColumn("Allocations"), textColumn("Contribution"), moneyColumn("Prize value (ZAR)"), moneyColumn("Commitment amount"), column("Payment", 16), column("Invoice"), column("Contact", 28), textColumn("Contact email"), column("Contact phone"), textColumn("Notes")], rows: byCompany(rows.map((row) => {
    const allocations = [...(row.units || [])].sort((a, b) => a.unit_number - b.unit_number).map((unit) => `${unit.unit_number}: ${unit.slot ? `${unit.slot.hole?.label || unit.slot.location_name || ""} · ${unit.slot.label}` : "Unallocated"}`);
    return [companyName(row), row.type?.name, label(row.type?.category), label(row.status), row.quantity, allocations.join("\n") || "Unallocated", row.contribution, rand(row.prize_value_minor), rand(row.confirmed_amount_minor), label(row.payment_status), row.invoice_reference, row.eventCompany?.primary_contact_name, row.eventCompany?.primary_contact_email, row.eventCompany?.primary_contact_phone, row.notes];
  })) };
}

export function buildExportSheets(data, type) {
  if (type === "invoices") return invoiceSheets(data);
  const confirmed = type === "confirmations" || type.startsWith("confirmed-");
  const companies = (data.companies || []).filter((row) => row.relationship_status === "confirmed");
  const fourballs = (data.fourballs || []).filter((row) => !confirmed || (row.booking_status === "confirmed" && activeCompany(row)));
  const players = (data.players || []).filter((row) => !confirmed || (row.fourball?.booking_status === "confirmed" && activeCompany(row.fourball)));
  const hosts = (data.hosts || []).filter((row) => !confirmed || (row.fourball?.booking_status === "confirmed" && activeCompany(row.fourball)));
  const commitments = (data.sponsors || []).filter((row) => !confirmed || (row.status === "confirmed" && activeCompany(row)));
  const sponsors = commitments.filter((row) => row.type?.category !== "supplier");
  const suppliers = commitments.filter((row) => row.type?.category === "supplier");
  const sponsorshipSheets = () => {
    const types = new Map((data.sponsorshipTypes || []).filter((row) => row.category !== "supplier").map((row) => [row.id, row]));
    for (const row of sponsors) types.set(row.type?.id || "unknown", row.type || { id: "unknown", name: "Other sponsorships" });
    return [...types.values()].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => sponsorsSheet(sponsors.filter((row) => (row.type?.id || "unknown") === entry.id), true, entry.name, `Confirmed ${entry.name}`));
  };
  if (type === "players") return [playersSheet(players, false)];
  if (type === "hosts") return [hostsSheet(hosts, false)];
  if (type.endsWith("fourballs")) return [fourballsSheet(fourballs, confirmed)];
  if (type.endsWith("suppliers")) return [sponsorsSheet(suppliers, confirmed, "Suppliers", confirmed ? "Confirmed suppliers" : "Supplier contributions")];
  if (type === "sponsors") return [sponsorsSheet(sponsors, false)];
  if (type === "confirmed-companies") return [companiesSheet(companies)];
  if (type === "confirmed-sponsors") {
    const sheets = sponsorshipSheets();
    return sheets.length ? sheets : [sponsorsSheet([], true, "Sponsorships", "Confirmed sponsorships")];
  }
  const total = (rows, key) => rows.reduce((sum, row) => sum + (row[key] || 0), 0);
  return [
    { name: "Summary", title: "All confirmations", note: "Confirmed records only. Company participation and booking confirmations are counted separately. Prize values are separate from booking income.", columns: [column("Confirmation type", 32), column("Records", 14, "integer"), column("Units", 14, "integer"), moneyColumn("Confirmed amount"), moneyColumn("Known prize value (ZAR)"), column("Missing prize values", 24, "integer")], rows: [
      ["Companies", companies.length, null, null, null, null],
      ["Fourballs", fourballs.length, fourballs.length, rand(total(fourballs, "confirmed_amount_minor")), null, null],
      ["Sponsorships", sponsors.length, total(sponsors, "quantity"), rand(total(sponsors, "confirmed_amount_minor")), rand(total(sponsors, "prize_value_minor")), sponsors.filter((row) => row.prize_value_minor == null).length],
      ["Suppliers", suppliers.length, total(suppliers, "quantity"), rand(total(suppliers, "confirmed_amount_minor")), rand(total(suppliers, "prize_value_minor")), suppliers.filter((row) => row.prize_value_minor == null).length],
      ["Players in confirmed fourballs", players.length, null, null, null, null],
      ["Host assignments", hosts.length, null, null, null, null],
    ] },
    companiesSheet(companies), fourballsSheet(fourballs, true), playersSheet(players, true), hostsSheet(hosts, true),
    sponsorsSheet(suppliers, true, "Suppliers", "Confirmed suppliers"), ...sponsorshipSheets(),
  ];
}

function invoiceSheets(data) {
  const groups = new Map();
  const details = [];
  const add = (row, kind, description, quantity) => {
    if (!activeCompany(row)) return;
    const company = row.eventCompany;
    // Group by event participation identity, never by a potentially duplicated company name.
    if (!company?.id) throw new Error("An invoice record is missing its company identity.");
    if (!groups.has(company.id)) groups.set(company.id, { company, fourballs: 0, amounts: { Fourball: 0, Sponsorship: 0, Supplier: 0 }, waived: 0, refs: new Set(), payments: new Set() });
    const group = groups.get(company.id);
    const agreed = row.confirmed_amount_minor;
    const waived = row.payment_status === "waived" ? agreed : 0;
    const charge = row.payment_status === "waived" ? 0 : agreed;
    group.amounts[kind] += charge;
    group.waived += waived;
    if (kind === "Fourball") group.fourballs += 1;
    if (row.invoice_reference?.trim()) group.refs.add(row.invoice_reference.trim());
    group.payments.add(label(row.payment_status));
    details.push([companyName(row), kind, description, quantity, rand(agreed), rand(waived), rand(charge), label(row.payment_status), row.invoice_reference]);
  };
  for (const row of data.fourballs || []) if (row.booking_status === "confirmed") add(row, "Fourball", row.team_name, 1);
  for (const row of data.sponsors || []) if (row.status === "confirmed") add(row, row.type?.category === "supplier" ? "Supplier" : "Sponsorship", [row.type?.name, row.contribution].filter(Boolean).join(" — "), row.quantity);
  const editable = (name, width = 24, extra = {}) => ({ ...column(name, width), editable: true, ...extra });
  return [
    { name: "Invoice tracker", title: "Company invoice tracker", noteHeight: 56, note: "Confirmed bookings only. Waived items contribute R0. Totals are invoice values, not outstanding balances; review existing references before invoicing. Blue columns are for your team to edit in Excel; edits do not sync to the website.", columns: [column("Company", 32), column("Fourballs", 14, "integer"), moneyColumn("Fourball amount"), moneyColumn("Sponsorship amount"), moneyColumn("Supplier amount"), moneyColumn("Waived amount"), moneyColumn("Total to invoice"), textColumn("Existing invoice references"), column("Source payment statuses", 28), editable("Invoice status", 28, { options: ["To invoice", "Review existing invoice", "Review payment", "In progress", "Invoiced", "No invoice required"] }), editable("Invoice number"), editable("Invoice date", 24, { format: "date" }), editable("Owner"), editable("Tracking notes", 40), textColumn("Billing email"), column("Contact", 28), textColumn("Contact email"), column("Phone")], rows: byCompany([...groups.values()].map((group) => {
      const total = group.amounts.Fourball + group.amounts.Sponsorship + group.amounts.Supplier;
      const status = total === 0 ? "No invoice required" : group.refs.size ? "Review existing invoice" : group.payments.has("Paid") || group.payments.has("Partial") ? "Review payment" : "To invoice";
      return [group.company.company?.name, group.fourballs, rand(group.amounts.Fourball), rand(group.amounts.Sponsorship), rand(group.amounts.Supplier), rand(group.waived), rand(total), [...group.refs].sort().join("\n"), [...group.payments].sort().join(", "), status, null, null, null, null, group.company.company?.billing_email, group.company.primary_contact_name, group.company.primary_contact_email, group.company.primary_contact_phone];
    })) },
    { name: "Invoice items", title: "Invoice booking breakdown", note: "Confirmed bookings only. One row per booking or commitment; amounts are totals, not unit prices. Waived charges are R0. Prize donation values are not invoiced.", columns: [column("Company", 32), column("Booking type", 22), textColumn("Description"), column("Quantity", 14, "integer"), moneyColumn("Agreed amount"), moneyColumn("Waived amount"), moneyColumn("Amount to invoice"), column("Payment status"), column("Existing invoice reference", 30)], rows: byCompany(details) },
  ];
}
