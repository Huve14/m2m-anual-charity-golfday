// Supabase schema contract for the additive multi-event migration.
// Regenerate after applying migrations with: npm run supabase:types
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type IdDates = { id: string; created_at: string; updated_at: string };
type EventOwned = { event_id: string };

export type Database = {
  public: {
    Tables: {
      m2m_profiles: Table<IdDates & { email: string; full_name: string; role: "super_admin" | "admin" | "host"; is_active: boolean; last_seen_at: string | null }>;
      m2m_events: Table<IdDates & { name: string; slug: string; status: "draft" | "active" | "completed" | "archived"; venue_name: string; venue_address: string; format: string; timezone: string; currency: string; shotgun_start_at: string | null; registration_deadline_at: string | null; player_deadline_at: string | null; rules: string; primary_colour: string; accent_colour: string; logo_path: string | null; banner_path: string | null; required_player_fields: Json; shirt_size_options: Json; reminder_offsets_days: Json; privacy_notice_version: string; created_by: string | null }>;
      m2m_event_holes: Table<EventOwned & { id: string; hole_number: number; label: string; par: number | null; sort_order: number; created_at: string }>;
      m2m_companies: Table<IdDates & { name: string; registration_number: string | null; website: string | null; billing_email: string | null; phone: string | null; notes: string | null; created_by: string | null }>;
      m2m_event_companies: Table<IdDates & EventOwned & { company_id: string; relationship_status: "prospect" | "pending" | "confirmed" | "cancelled"; primary_contact_name: string | null; primary_contact_email: string | null; primary_contact_phone: string | null; primary_contact_profile_id: string | null; notes: string | null }>;
      m2m_sponsorship_types: Table<IdDates & EventOwned & { name: string; category: "alcoholic_hole" | "non_alcoholic_hole" | "branded_hole" | "other"; capacity: number; price_minor: number; requires_hole: boolean; is_active: boolean; sort_order: number }>;
      m2m_fourball_types: Table<IdDates & EventOwned & { name: string; capacity: number; price_minor: number; is_active: boolean; sort_order: number }>;
      m2m_sponsorship_commitments: Table<IdDates & EventOwned & { event_company_id: string; sponsorship_type_id: string; status: "draft" | "reserved" | "confirmed" | "cancelled"; quantity: number; confirmed_amount_minor: number; invoice_reference: string | null; payment_status: "unpaid" | "partial" | "paid" | "waived"; notes: string | null }>;
      m2m_hole_sponsorship_slots: Table<EventOwned & { id: string; hole_id: string; label: string; sponsorship_type_id: string | null; sort_order: number; created_at: string }>;
      m2m_sponsorship_units: Table<EventOwned & { id: string; commitment_id: string; unit_number: number; hole_slot_id: string | null; allocated_at: string | null; allocated_by: string | null; created_at: string }>;
      m2m_fourballs: Table<IdDates & EventOwned & { event_company_id: string; fourball_type_id: string | null; team_name: string; booking_status: "pending" | "confirmed" | "cancelled"; unit_price_minor: number; confirmed_amount_minor: number; invoice_reference: string | null; payment_status: "unpaid" | "partial" | "paid" | "waived"; submission_status: "draft" | "submitted" | "reopened"; submitted_at: string | null; submitted_by: string | null; consent_version: string | null; consented_at: string | null; notes: string | null }>;
      m2m_tee_slots: Table<IdDates & EventOwned & { hole_id: string; slot_label: string; fourball_id: string | null; sort_order: number }>;
      m2m_fourball_hosts: Table<EventOwned & { id: string; fourball_id: string; profile_id: string; is_primary: boolean; invited_at: string | null; accepted_at: string | null; last_notified_at: string | null; created_at: string }>;
      m2m_players: Table<IdDates & EventOwned & { fourball_id: string; position: number; full_name: string; email: string; phone: string; handicap: string; shirt_size: string; dietary_requirements: string; special_requirements: string; home_club: string; golf_id: string }>;
      m2m_event_player_fields: Table<IdDates & EventOwned & { field_key: string; label: string; field_type: "text" | "number" | "select" | "checkbox"; options: Json; is_required: boolean; sort_order: number }>;
      m2m_player_field_responses: Table<EventOwned & { player_id: string; field_id: string; value: Json; updated_at: string }>;
      m2m_notification_deliveries: Table<EventOwned & { id: string; fourball_id: string | null; profile_id: string | null; delivery_type: "invite" | "reminder" | "magic_link" | "submission_confirmation"; dedupe_key: string; recipient_email: string; status: "pending" | "sent" | "failed" | "skipped"; provider_id: string | null; failure_code: string | null; scheduled_for: string | null; sent_at: string | null; created_at: string }>;
      m2m_audit_events: Table<EventOwned & { id: number; actor_profile_id: string | null; action: string; entity_type: string; entity_id: string; metadata: Json; created_at: string }>;
      m2m_legacy_enquiry_conversions: Table<EventOwned & { id: string; registration_id: string; event_company_id: string; converted_by: string | null; conversion_summary: Json; converted_at: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      m2m_activate_event: { Args: { p_event_id: string; p_actor_id: string }; Returns: undefined };
      m2m_allocate_sponsorship_unit: { Args: { p_event_id: string; p_unit_id: string; p_hole_slot_id: string; p_actor_id: string }; Returns: undefined };
      m2m_assign_tee_slot: { Args: { p_event_id: string; p_slot_id: string; p_fourball_id: string; p_actor_id: string }; Returns: undefined };
      m2m_convert_legacy_enquiry: { Args: { p_registration_id: string; p_event_id: string; p_company_id: string | null; p_company_name: string; p_sponsorship_type_id: string | null; p_host_profile_id: string | null; p_actor_id: string }; Returns: Json };
      m2m_reopen_fourball: { Args: { p_event_id: string; p_fourball_id: string; p_actor_id: string }; Returns: undefined };
      m2m_submit_fourball: { Args: { p_event_id: string; p_fourball_id: string; p_actor_id: string; p_consent_version: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
