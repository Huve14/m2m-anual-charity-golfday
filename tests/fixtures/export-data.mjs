export const eventId = "10000000-0000-4000-8000-000000000001";
export const event = { id: eventId, name: "M2M Annual Charity Golf Day", slug: "golf-day-2026", venue_name: "Glendower Golf Club", shotgun_start_at: "2026-10-15T09:00:00Z", currency: "ZAR", timezone: "Africa/Johannesburg", primary_colour: "#0C1735", accent_colour: "#ED1C24" };
const company = { relationship_status: "confirmed", primary_contact_name: "Alex Example", primary_contact_email: "alex@example.test", primary_contact_phone: "+27000123456", company: { name: "Example Company", billing_email: "billing@example.test", phone: "0012345" } };
const cancelled = { ...company, relationship_status: "cancelled", company: { name: "Cancelled Company" } };
const fourball = { id: "fourball-1", eventCompany: company, team_name: "Example Fourball", booking_status: "confirmed", submission_status: "draft", confirmed_amount_minor: 1000050, payment_status: "unpaid", type: { name: "Standard Fourball" }, tee: { slot_label: "A", hole: { label: "Hole 1" } }, hosts: [{ is_primary: true, profile: { full_name: "Alex Example", email: "alex@example.test" } }] };
const types = [
  { id: "alcohol", name: "Alcoholic Hole", category: "alcoholic_hole" },
  { id: "soft", name: "Non-alcoholic Hole", category: "non_alcoholic_hole" },
  { id: "brand", name: "Branded Hole", category: "branded_hole" },
  { id: "other", name: "Custom Confirmation", category: "other" },
  { id: "supplier", name: "Supplier", category: "supplier" },
  { id: "empty", name: "Empty Sponsorship Type", category: "other" },
];
const sponsorship = (type, index) => ({ id: `sponsor-${index}`, eventCompany: company, type, status: "confirmed", quantity: 2, confirmed_amount_minor: 123450, prize_value_minor: null, contribution: "Event contribution", payment_status: "unpaid", units: [{ unit_number: 1, slot: { hole: { label: "Hole 4" }, label: "A" } }, { unit_number: 2, slot: null }] });
export const data = {
  companies: [{ id: "company-1", ...company }, { id: "company-2", ...cancelled }, { id: "company-3", ...company, relationship_status: "pending" }],
  fourballs: [fourball, { ...fourball, id: "fourball-2", booking_status: "pending" }, { ...fourball, id: "fourball-3", eventCompany: cancelled }, { ...fourball, id: "fourball-4", booking_status: "cancelled" }],
  players: [{ id: "player-1", position: 1, full_name: "=Literal player name", phone: "+27000123456", golf_id: "000123", fourball }, { id: "player-2", position: 1, full_name: "Pending booking player", fourball: { ...fourball, booking_status: "pending" } }],
  hosts: [{ id: "host-1", is_primary: true, invited_at: "2026-09-10T08:00:00Z", accepted_at: null, profile: fourball.hosts[0].profile, fourball }, { id: "host-2", profile: fourball.hosts[0].profile, fourball: { ...fourball, eventCompany: cancelled } }],
  sponsors: [
    ...types.slice(0, 4).map(sponsorship),
    { ...sponsorship(types[4], 4), contribution: "Two prize hampers", prize_value_minor: 500050, units: [], confirmed_amount_minor: 0 },
    { ...sponsorship(types[4], 5), contribution: "Unvalued prize", prize_value_minor: null, units: [], confirmed_amount_minor: 0 },
    { ...sponsorship(types[0], 6), status: "reserved" },
    { ...sponsorship(types[0], 7), status: "cancelled" },
    { ...sponsorship(types[0], 8), eventCompany: cancelled },
  ],
  sponsorshipTypes: types,
};
