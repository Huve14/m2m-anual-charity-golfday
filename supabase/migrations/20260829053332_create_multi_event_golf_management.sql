-- Multi-event golf-day operations model.
-- Existing m2m_registrations and m2m_admin_users tables are intentionally
-- preserved so the public registration flow and deployment rollback remain safe.

create extension if not exists pgcrypto;

create table public.m2m_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'host'
    check (role in ('super_admin', 'admin', 'host')),
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint m2m_profiles_email_normalised check (email = lower(btrim(email))),
  constraint m2m_profiles_email_shape check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create unique index m2m_profiles_email_uidx on public.m2m_profiles (lower(email));

create table public.m2m_events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'archived')),
  venue_name text not null default '',
  venue_address text not null default '',
  format text not null default 'Better Ball',
  timezone text not null default 'Africa/Johannesburg',
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  shotgun_start_at timestamptz,
  registration_deadline_at timestamptz,
  player_deadline_at timestamptz,
  rules text not null default '',
  primary_colour text not null default '#0C1735'
    check (primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  accent_colour text not null default '#ED1C24'
    check (accent_colour ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  banner_path text,
  required_player_fields jsonb not null default '["full_name","email","phone","handicap","shirt_size"]'::jsonb
    check (jsonb_typeof(required_player_fields) = 'array'),
  shirt_size_options jsonb not null default '["XS","S","M","L","XL","2XL","3XL"]'::jsonb
    check (jsonb_typeof(shirt_size_options) = 'array'),
  reminder_offsets_days jsonb not null default '[14,7,2]'::jsonb
    check (jsonb_typeof(reminder_offsets_days) = 'array'),
  privacy_notice_version text not null default 'POPIA-2026-08-20',
  created_by uuid references public.m2m_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint m2m_events_deadline_order check (
    shotgun_start_at is null
    or registration_deadline_at is null
    or registration_deadline_at < shotgun_start_at
  ),
  constraint m2m_events_player_deadline_order check (
    shotgun_start_at is null
    or player_deadline_at is null
    or player_deadline_at < shotgun_start_at
  )
);

create index m2m_events_status_start_idx on public.m2m_events (status, shotgun_start_at);

create table public.m2m_event_holes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 36),
  label text not null,
  par integer check (par between 3 and 6),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, hole_number),
  unique (id, event_id)
);

create index m2m_event_holes_event_idx on public.m2m_event_holes (event_id, sort_order);

create table public.m2m_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 180),
  registration_number text,
  website text,
  billing_email text,
  phone text,
  notes text,
  created_by uuid references public.m2m_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index m2m_companies_name_uidx on public.m2m_companies (lower(btrim(name)));

create table public.m2m_event_companies (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  company_id uuid not null references public.m2m_companies (id) on delete restrict,
  relationship_status text not null default 'prospect'
    check (relationship_status in ('prospect', 'pending', 'confirmed', 'cancelled')),
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, company_id),
  unique (id, event_id)
);

create index m2m_event_companies_event_idx on public.m2m_event_companies (event_id, relationship_status);

create table public.m2m_sponsorship_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('alcoholic_hole', 'non_alcoholic_hole', 'branded_hole', 'other')),
  capacity integer not null default 0 check (capacity >= 0),
  price_minor integer not null default 0 check (price_minor >= 0),
  requires_hole boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name),
  unique (id, event_id)
);

create index m2m_sponsorship_types_event_idx on public.m2m_sponsorship_types (event_id, sort_order);

create table public.m2m_sponsorship_commitments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  event_company_id uuid not null,
  sponsorship_type_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft', 'reserved', 'confirmed', 'cancelled')),
  quantity integer not null default 1 check (quantity > 0),
  confirmed_amount_minor integer not null default 0 check (confirmed_amount_minor >= 0),
  invoice_reference text,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid', 'waived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (event_company_id, event_id)
    references public.m2m_event_companies (id, event_id) on delete cascade,
  foreign key (sponsorship_type_id, event_id)
    references public.m2m_sponsorship_types (id, event_id) on delete restrict
);

create index m2m_sponsorship_commitments_event_idx
  on public.m2m_sponsorship_commitments (event_id, status);
create index m2m_sponsorship_commitments_company_idx
  on public.m2m_sponsorship_commitments (event_company_id);

create table public.m2m_hole_sponsorship_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  hole_id uuid not null,
  label text not null default 'Sponsor',
  sponsorship_type_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, event_id),
  unique (hole_id, label),
  foreign key (hole_id, event_id)
    references public.m2m_event_holes (id, event_id) on delete cascade,
  foreign key (sponsorship_type_id, event_id)
    references public.m2m_sponsorship_types (id, event_id) on delete restrict
);

create index m2m_hole_sponsorship_slots_event_idx
  on public.m2m_hole_sponsorship_slots (event_id, hole_id, sort_order);

create table public.m2m_sponsorship_units (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  commitment_id uuid not null,
  unit_number integer not null check (unit_number > 0),
  hole_slot_id uuid,
  allocated_at timestamptz,
  allocated_by uuid references public.m2m_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (commitment_id, unit_number),
  unique (hole_slot_id),
  foreign key (commitment_id, event_id)
    references public.m2m_sponsorship_commitments (id, event_id) on delete cascade,
  foreign key (hole_slot_id, event_id)
    references public.m2m_hole_sponsorship_slots (id, event_id) on delete restrict
);

create index m2m_sponsorship_units_event_idx on public.m2m_sponsorship_units (event_id, commitment_id);

create table public.m2m_fourballs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  event_company_id uuid not null,
  team_name text not null,
  booking_status text not null default 'pending'
    check (booking_status in ('pending', 'confirmed', 'cancelled')),
  confirmed_amount_minor integer not null default 0 check (confirmed_amount_minor >= 0),
  invoice_reference text,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid', 'waived')),
  submission_status text not null default 'draft'
    check (submission_status in ('draft', 'submitted', 'reopened')),
  submitted_at timestamptz,
  submitted_by uuid references public.m2m_profiles (id) on delete set null,
  consent_version text,
  consented_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (event_company_id, event_id)
    references public.m2m_event_companies (id, event_id) on delete cascade,
  constraint m2m_fourballs_submission_state check (
    (submission_status = 'submitted' and submitted_at is not null and submitted_by is not null and consented_at is not null)
    or submission_status <> 'submitted'
  )
);

create index m2m_fourballs_event_idx
  on public.m2m_fourballs (event_id, booking_status, submission_status);
create index m2m_fourballs_company_idx on public.m2m_fourballs (event_company_id);

create table public.m2m_tee_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  hole_id uuid not null,
  slot_label text not null default 'A',
  fourball_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, hole_id, slot_label),
  unique (fourball_id),
  foreign key (hole_id, event_id)
    references public.m2m_event_holes (id, event_id) on delete cascade,
  foreign key (fourball_id, event_id)
    references public.m2m_fourballs (id, event_id) on delete restrict
);

create index m2m_tee_slots_event_idx on public.m2m_tee_slots (event_id, sort_order);

create table public.m2m_fourball_hosts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  fourball_id uuid not null,
  profile_id uuid not null references public.m2m_profiles (id) on delete restrict,
  is_primary boolean not null default false,
  invited_at timestamptz,
  accepted_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (fourball_id, profile_id),
  foreign key (fourball_id, event_id)
    references public.m2m_fourballs (id, event_id) on delete cascade
);

create unique index m2m_fourball_hosts_one_primary_uidx
  on public.m2m_fourball_hosts (fourball_id) where is_primary;
create index m2m_fourball_hosts_profile_idx
  on public.m2m_fourball_hosts (profile_id, event_id);

create table public.m2m_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  fourball_id uuid not null,
  position integer not null check (position between 1 and 4),
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  handicap text not null default '',
  shirt_size text not null default '',
  dietary_requirements text not null default '',
  special_requirements text not null default '',
  home_club text not null default '',
  golf_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fourball_id, position),
  unique (id, event_id),
  foreign key (fourball_id, event_id)
    references public.m2m_fourballs (id, event_id) on delete cascade
);

create index m2m_players_event_idx on public.m2m_players (event_id, fourball_id, position);

create table public.m2m_event_player_fields (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null,
  field_type text not null default 'text'
    check (field_type in ('text', 'number', 'select', 'checkbox')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, field_key),
  unique (id, event_id)
);

create index m2m_event_player_fields_event_idx
  on public.m2m_event_player_fields (event_id, sort_order);

create table public.m2m_player_field_responses (
  player_id uuid not null,
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  field_id uuid not null,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (player_id, field_id),
  foreign key (player_id, event_id)
    references public.m2m_players (id, event_id) on delete cascade,
  foreign key (field_id, event_id)
    references public.m2m_event_player_fields (id, event_id) on delete cascade
);

create index m2m_player_field_responses_event_idx
  on public.m2m_player_field_responses (event_id, player_id);

create table public.m2m_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  fourball_id uuid,
  profile_id uuid references public.m2m_profiles (id) on delete set null,
  delivery_type text not null
    check (delivery_type in ('invite', 'reminder', 'magic_link', 'submission_confirmation')),
  dedupe_key text not null unique,
  recipient_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_id text,
  failure_code text,
  scheduled_for date,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (fourball_id, event_id)
    references public.m2m_fourballs (id, event_id) on delete cascade
);

create index m2m_notification_deliveries_event_idx
  on public.m2m_notification_deliveries (event_id, delivery_type, status);

create table public.m2m_audit_events (
  id bigint generated always as identity primary key,
  event_id uuid references public.m2m_events (id) on delete set null,
  actor_profile_id uuid references public.m2m_profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index m2m_audit_events_event_idx
  on public.m2m_audit_events (event_id, created_at desc);

create table public.m2m_legacy_enquiry_conversions (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique,
  event_id uuid not null references public.m2m_events (id) on delete restrict,
  event_company_id uuid not null,
  converted_by uuid references public.m2m_profiles (id) on delete set null,
  conversion_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(conversion_summary) = 'object'),
  converted_at timestamptz not null default now(),
  foreign key (event_company_id, event_id)
    references public.m2m_event_companies (id, event_id) on delete restrict
);

create index m2m_legacy_enquiry_conversions_event_idx
  on public.m2m_legacy_enquiry_conversions (event_id, converted_at desc);

create or replace function public.m2m_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'm2m_profiles', 'm2m_events', 'm2m_companies', 'm2m_event_companies',
    'm2m_sponsorship_types', 'm2m_sponsorship_commitments', 'm2m_fourballs',
    'm2m_tee_slots', 'm2m_players', 'm2m_event_player_fields'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.m2m_touch_updated_at()', target_table || '_touch_updated_at', target_table);
  end loop;
end;
$$;

create or replace function public.m2m_guard_sponsorship_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allowed_capacity integer;
  committed_quantity integer;
begin
  if new.status not in ('reserved', 'confirmed') then
    return new;
  end if;

  select capacity into allowed_capacity
  from public.m2m_sponsorship_types
  where id = new.sponsorship_type_id and event_id = new.event_id
  for update;

  select coalesce(sum(quantity), 0) into committed_quantity
  from public.m2m_sponsorship_commitments
  where sponsorship_type_id = new.sponsorship_type_id
    and event_id = new.event_id
    and status in ('reserved', 'confirmed')
    and id <> new.id;

  if committed_quantity + new.quantity > allowed_capacity then
    raise exception using errcode = '23514', message = 'm2m_sponsorship_capacity_exceeded';
  end if;
  return new;
end;
$$;

create trigger m2m_sponsorship_commitments_guard_capacity
before insert or update of sponsorship_type_id, event_id, status, quantity
on public.m2m_sponsorship_commitments
for each row execute function public.m2m_guard_sponsorship_capacity();

create or replace function public.m2m_guard_sponsorship_type_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed_quantity integer;
begin
  if new.capacity >= old.capacity then
    return new;
  end if;
  select coalesce(sum(quantity), 0) into committed_quantity
  from public.m2m_sponsorship_commitments
  where sponsorship_type_id = new.id
    and event_id = new.event_id
    and status in ('reserved', 'confirmed');
  if new.capacity < committed_quantity then
    raise exception using errcode = '23514', message = 'm2m_sponsorship_capacity_below_committed';
  end if;
  return new;
end;
$$;

create trigger m2m_sponsorship_types_guard_capacity
before update of capacity on public.m2m_sponsorship_types
for each row execute function public.m2m_guard_sponsorship_type_capacity();

create or replace function public.m2m_sync_commitment_units_trigger()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  unit_index integer;
begin
  for unit_index in 1..new.quantity loop
    insert into public.m2m_sponsorship_units (event_id, commitment_id, unit_number)
    values (new.event_id, new.id, unit_index)
    on conflict (commitment_id, unit_number) do nothing;
  end loop;

  if exists (
    select 1 from public.m2m_sponsorship_units
    where commitment_id = new.id and unit_number > new.quantity and hole_slot_id is not null
  ) then
    raise exception using errcode = '23514', message = 'm2m_allocated_units_prevent_quantity_reduction';
  end if;

  delete from public.m2m_sponsorship_units
  where commitment_id = new.id and unit_number > new.quantity;
  return new;
end;
$$;

create trigger m2m_sponsorship_commitments_sync_units
after insert or update of quantity
on public.m2m_sponsorship_commitments
for each row execute function public.m2m_sync_commitment_units_trigger();

create or replace function public.m2m_assign_tee_slot(
  p_event_id uuid,
  p_slot_id uuid,
  p_fourball_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status text;
begin
  perform 1 from public.m2m_tee_slots where id = p_slot_id and event_id = p_event_id for update;
  select booking_status into current_status
  from public.m2m_fourballs
  where id = p_fourball_id and event_id = p_event_id
  for update;

  if current_status is null then
    raise exception using errcode = 'P0002', message = 'm2m_fourball_not_found';
  end if;
  if current_status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'm2m_fourball_must_be_confirmed';
  end if;

  update public.m2m_tee_slots set fourball_id = null
  where event_id = p_event_id and fourball_id = p_fourball_id;
  update public.m2m_tee_slots set fourball_id = p_fourball_id
  where id = p_slot_id and event_id = p_event_id and fourball_id is null;
  if not found then
    raise exception using errcode = '23505', message = 'm2m_tee_slot_already_assigned';
  end if;

  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (p_event_id, p_actor_id, 'tee_slot.assigned', 'fourball', p_fourball_id::text, jsonb_build_object('slotId', p_slot_id));
end;
$$;

create or replace function public.m2m_allocate_sponsorship_unit(
  p_event_id uuid,
  p_unit_id uuid,
  p_hole_slot_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  commitment_status text;
  commitment_type uuid;
  slot_type uuid;
begin
  select c.status, c.sponsorship_type_id into commitment_status, commitment_type
  from public.m2m_sponsorship_units u
  join public.m2m_sponsorship_commitments c on c.id = u.commitment_id
  where u.id = p_unit_id and u.event_id = p_event_id
  for update of u, c;

  if commitment_status is null then
    raise exception using errcode = 'P0002', message = 'm2m_sponsorship_unit_not_found';
  end if;
  if commitment_status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'm2m_sponsorship_must_be_confirmed';
  end if;

  select sponsorship_type_id into slot_type
  from public.m2m_hole_sponsorship_slots
  where id = p_hole_slot_id and event_id = p_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'm2m_hole_slot_not_found';
  end if;
  if slot_type is not null and slot_type <> commitment_type then
    raise exception using errcode = '23514', message = 'm2m_hole_slot_type_mismatch';
  end if;

  update public.m2m_sponsorship_units
  set hole_slot_id = p_hole_slot_id, allocated_at = now(), allocated_by = p_actor_id
  where id = p_unit_id and event_id = p_event_id;

  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (p_event_id, p_actor_id, 'sponsorship.allocated', 'sponsorship_unit', p_unit_id::text, jsonb_build_object('holeSlotId', p_hole_slot_id));
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'm2m_hole_slot_already_allocated';
end;
$$;

create or replace function public.m2m_submit_fourball(
  p_event_id uuid,
  p_fourball_id uuid,
  p_actor_id uuid,
  p_consent_version text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  required_fields jsonb;
  deadline timestamptz;
  expected_consent_version text;
  incomplete_count integer;
  missing_custom integer;
begin
  select required_player_fields, player_deadline_at, privacy_notice_version into required_fields, deadline, expected_consent_version
  from public.m2m_events where id = p_event_id for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'm2m_event_not_found';
  end if;

  if deadline is not null and now() > deadline then
    raise exception using errcode = '23514', message = 'm2m_player_deadline_passed';
  end if;
  if p_consent_version is distinct from expected_consent_version then
    raise exception using errcode = '23514', message = 'm2m_privacy_notice_version_mismatch';
  end if;

  select count(*) into incomplete_count
  from public.m2m_players
  where event_id = p_event_id and fourball_id = p_fourball_id
    and (
      (required_fields ? 'full_name' and btrim(full_name) = '')
      or (required_fields ? 'email' and btrim(email) = '')
      or (required_fields ? 'phone' and btrim(phone) = '')
      or (required_fields ? 'handicap' and btrim(handicap) = '')
      or (required_fields ? 'shirt_size' and btrim(shirt_size) = '')
      or (required_fields ? 'dietary_requirements' and btrim(dietary_requirements) = '')
      or (required_fields ? 'special_requirements' and btrim(special_requirements) = '')
      or (required_fields ? 'home_club' and btrim(home_club) = '')
      or (required_fields ? 'golf_id' and btrim(golf_id) = '')
    );

  if (select count(*) from public.m2m_players where event_id = p_event_id and fourball_id = p_fourball_id) <> 4
     or incomplete_count > 0 then
    raise exception using errcode = '23514', message = 'm2m_player_details_incomplete';
  end if;

  select count(*) into missing_custom
  from public.m2m_event_player_fields f
  cross join public.m2m_players p
  left join public.m2m_player_field_responses r on r.field_id = f.id and r.player_id = p.id
  where f.event_id = p_event_id and f.is_required
    and p.fourball_id = p_fourball_id
    and (r.player_id is null or r.value = 'null'::jsonb or r.value = '""'::jsonb);
  if missing_custom > 0 then
    raise exception using errcode = '23514', message = 'm2m_custom_player_details_incomplete';
  end if;

  update public.m2m_fourballs
  set submission_status = 'submitted', submitted_at = now(), submitted_by = p_actor_id,
      consent_version = p_consent_version, consented_at = now()
  where id = p_fourball_id and event_id = p_event_id and booking_status <> 'cancelled';
  if not found then
    raise exception using errcode = 'P0002', message = 'm2m_fourball_not_found';
  end if;

  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id)
  values (p_event_id, p_actor_id, 'fourball.submitted', 'fourball', p_fourball_id::text);
end;
$$;

create or replace function public.m2m_reopen_fourball(
  p_event_id uuid,
  p_fourball_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.m2m_fourballs
  set submission_status = 'reopened', submitted_at = null, submitted_by = null,
      consent_version = null, consented_at = null
  where id = p_fourball_id and event_id = p_event_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'm2m_fourball_not_found';
  end if;
  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id)
  values (p_event_id, p_actor_id, 'fourball.reopened', 'fourball', p_fourball_id::text);
end;
$$;

create or replace function public.m2m_activate_event(p_event_id uuid, p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.m2m_events%rowtype;
begin
  select * into target from public.m2m_events where id = p_event_id for update;
  if target.id is null then
    raise exception using errcode = 'P0002', message = 'm2m_event_not_found';
  end if;
  if btrim(target.venue_name) = '' or btrim(target.format) = '' or btrim(target.rules) = ''
     or target.shotgun_start_at is null or target.registration_deadline_at is null
     or target.player_deadline_at is null
     or not exists (select 1 from public.m2m_event_holes where event_id = p_event_id)
     or not exists (select 1 from public.m2m_tee_slots where event_id = p_event_id) then
    raise exception using errcode = '23514', message = 'm2m_event_setup_incomplete';
  end if;
  update public.m2m_events set status = 'active' where id = p_event_id;
  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id)
  values (p_event_id, p_actor_id, 'event.activated', 'event', p_event_id::text);
end;
$$;

create or replace function public.m2m_protect_final_profile_super_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  lock table public.m2m_profiles in share row exclusive mode;
  if old.role = 'super_admin' and old.is_active
     and (new.role <> 'super_admin' or not new.is_active)
     and not exists (
       select 1 from public.m2m_profiles
       where id <> old.id and role = 'super_admin' and is_active
     ) then
    raise exception using errcode = '23514', message = 'm2m_last_super_admin';
  end if;
  return new;
end;
$$;

create trigger m2m_profiles_protect_final_super_admin
before update of role, is_active on public.m2m_profiles
for each row execute function public.m2m_protect_final_profile_super_admin();

create or replace function public.m2m_convert_legacy_enquiry(
  p_registration_id text,
  p_event_id uuid,
  p_company_id uuid,
  p_company_name text,
  p_sponsorship_type_id uuid,
  p_host_profile_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_row record;
  target_company_id uuid;
  target_event_company_id uuid;
  target_fourball_id uuid;
  team_index integer;
  player_position integer;
  source_player jsonb;
  source_row_count integer := 0;
  created_fourballs jsonb := '[]'::jsonb;
  target_sponsorship_price integer := 0;
begin
  if exists (select 1 from public.m2m_legacy_enquiry_conversions where registration_id = p_registration_id) then
    raise exception using errcode = '23505', message = 'm2m_enquiry_already_converted';
  end if;

  -- The legacy table is deliberately not recreated here. Dynamic SQL keeps this
  -- additive migration usable on a clean development branch while the RPC still
  -- fails atomically if the separately managed compatibility table is absent.
  execute 'select * from public.m2m_registrations where registration_id = $1 for update'
    into source_row using p_registration_id;
  get diagnostics source_row_count = row_count;
  if source_row_count = 0 then
    raise exception using errcode = 'P0002', message = 'm2m_enquiry_not_found';
  end if;

  target_company_id := p_company_id;
  if target_company_id is null then
    insert into public.m2m_companies (name, billing_email, phone, created_by)
    values (coalesce(nullif(btrim(p_company_name), ''), source_row.company, 'Individual registration'), source_row.email, source_row.phone, p_actor_id)
    returning id into target_company_id;
  end if;

  insert into public.m2m_event_companies (
    event_id, company_id, relationship_status, primary_contact_name,
    primary_contact_email, primary_contact_phone, notes
  ) values (
    p_event_id, target_company_id, 'pending', source_row.contact_name,
    source_row.email, source_row.phone, source_row.notes
  )
  on conflict (event_id, company_id) do update set
    primary_contact_name = coalesce(public.m2m_event_companies.primary_contact_name, excluded.primary_contact_name),
    primary_contact_email = coalesce(public.m2m_event_companies.primary_contact_email, excluded.primary_contact_email),
    primary_contact_phone = coalesce(public.m2m_event_companies.primary_contact_phone, excluded.primary_contact_phone)
  returning id into target_event_company_id;

  for team_index in 1..source_row.fourball_count loop
    insert into public.m2m_fourballs (
      event_id, event_company_id, team_name, booking_status,
      confirmed_amount_minor, payment_status, notes
    ) values (
      p_event_id, target_event_company_id,
      coalesce(nullif(source_row.company, ''), source_row.contact_name, 'Golf') ||
        case when source_row.fourball_count > 1 then ' Team ' || team_index else ' Fourball' end,
      'pending', greatest(0, (source_row.fourball_amount * 100) / source_row.fourball_count), 'unpaid',
      'Converted from website enquiry ' || source_row.registration_id
    ) returning id into target_fourball_id;

    for player_position in 1..4 loop
      source_player := source_row.players -> ((team_index - 1) * 4 + player_position - 1);
      insert into public.m2m_players (
        event_id, fourball_id, position, full_name, handicap
      ) values (
        p_event_id, target_fourball_id, player_position,
        coalesce(source_player ->> 'name', ''), coalesce(source_player ->> 'handicap', '')
      );
    end loop;

    if p_host_profile_id is not null then
      insert into public.m2m_fourball_hosts (
        event_id, fourball_id, profile_id, is_primary
      ) values (p_event_id, target_fourball_id, p_host_profile_id, true);
    end if;
    created_fourballs := created_fourballs || jsonb_build_array(target_fourball_id);
  end loop;

  if p_sponsorship_type_id is not null and source_row.sponsorship_amount > 0 then
    select price_minor into target_sponsorship_price
    from public.m2m_sponsorship_types
    where id = p_sponsorship_type_id and event_id = p_event_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'm2m_sponsorship_type_not_found';
    end if;
    insert into public.m2m_sponsorship_commitments (
      event_id, event_company_id, sponsorship_type_id, status, quantity,
      confirmed_amount_minor, payment_status, notes
    ) values (
      p_event_id, target_event_company_id, p_sponsorship_type_id, 'reserved', 1,
      coalesce(nullif(source_row.sponsorship_amount * 100, 0), target_sponsorship_price), 'unpaid',
      'Converted from website enquiry ' || source_row.registration_id
    );
  end if;

  insert into public.m2m_legacy_enquiry_conversions (
    registration_id, event_id, event_company_id, converted_by, conversion_summary
  ) values (
    source_row.registration_id, p_event_id, target_event_company_id, p_actor_id,
    jsonb_build_object('fourballIds', created_fourballs, 'companyId', target_company_id)
  );

  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (p_event_id, p_actor_id, 'legacy_enquiry.converted', 'legacy_enquiry', source_row.registration_id,
    jsonb_build_object('eventCompanyId', target_event_company_id, 'fourballIds', created_fourballs));

  return jsonb_build_object(
    'registrationId', source_row.registration_id,
    'companyId', target_company_id,
    'eventCompanyId', target_event_company_id,
    'fourballIds', created_fourballs
  );
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'm2m_profiles', 'm2m_events', 'm2m_event_holes', 'm2m_companies',
    'm2m_event_companies', 'm2m_sponsorship_types', 'm2m_sponsorship_commitments',
    'm2m_hole_sponsorship_slots', 'm2m_sponsorship_units', 'm2m_fourballs',
    'm2m_tee_slots', 'm2m_fourball_hosts', 'm2m_players', 'm2m_event_player_fields',
    'm2m_player_field_responses', 'm2m_notification_deliveries', 'm2m_audit_events',
    'm2m_legacy_enquiry_conversions'
  ] loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('alter table public.%I force row level security', target_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', target_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', target_table);
  end loop;
end;
$$;

revoke all on function public.m2m_touch_updated_at() from public, anon, authenticated;
revoke all on function public.m2m_guard_sponsorship_capacity() from public, anon, authenticated;
revoke all on function public.m2m_guard_sponsorship_type_capacity() from public, anon, authenticated;
revoke all on function public.m2m_sync_commitment_units_trigger() from public, anon, authenticated;
revoke all on function public.m2m_assign_tee_slot(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.m2m_allocate_sponsorship_unit(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.m2m_submit_fourball(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.m2m_reopen_fourball(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.m2m_activate_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.m2m_protect_final_profile_super_admin() from public, anon, authenticated;
revoke all on function public.m2m_convert_legacy_enquiry(text, uuid, uuid, text, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.m2m_assign_tee_slot(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.m2m_allocate_sponsorship_unit(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.m2m_submit_fourball(uuid, uuid, uuid, text) to service_role;
grant execute on function public.m2m_reopen_fourball(uuid, uuid, uuid) to service_role;
grant execute on function public.m2m_activate_event(uuid, uuid) to service_role;
grant execute on function public.m2m_convert_legacy_enquiry(text, uuid, uuid, text, uuid, uuid, uuid) to service_role;
grant usage, select on sequence public.m2m_audit_events_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'm2m-event-branding',
  'm2m-event-branding',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
