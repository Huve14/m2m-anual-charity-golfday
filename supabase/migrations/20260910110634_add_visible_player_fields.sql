-- Existing events keep all player fields visible. Required fields must be visible
-- so the existing submission and completion checks cannot demand hidden data.
alter table public.m2m_events
  add column visible_player_fields jsonb not null default '["full_name", "email", "phone", "handicap", "shirt_size", "dietary_requirements", "special_requirements", "home_club", "golf_id"]'::jsonb,
  add constraint m2m_events_visible_player_fields_valid check (
    jsonb_typeof(visible_player_fields) = 'array'
    and visible_player_fields <@ '["full_name", "email", "phone", "handicap", "shirt_size", "dietary_requirements", "special_requirements", "home_club", "golf_id"]'::jsonb
    and required_player_fields <@ visible_player_fields
  );
