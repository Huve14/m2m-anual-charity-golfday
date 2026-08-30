-- M2M Invitational host portal.
-- This migration is designed for the isolated staging project first. It does
-- not alter the existing public m2m_registrations enquiry table.

create extension if not exists pgcrypto with schema extensions;

create table public.golf_events (
  id uuid primary key default extensions.gen_random_uuid(),
  event_code text not null unique,
  name text not null,
  venue text not null,
  event_date date not null,
  shotgun_start time not null,
  portal_open boolean not null default true,
  roster_editable boolean not null default true,
  portal_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_events_code_check check (event_code ~ '^[a-z0-9-]{3,64}$'),
  constraint golf_events_name_check check (char_length(btrim(name)) between 3 and 160),
  constraint golf_events_venue_check check (char_length(btrim(venue)) between 3 and 160)
);

create table public.package_catalog (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.golf_events(id) on delete cascade,
  code text not null,
  display_name text not null,
  allocation_type text not null,
  price_zar integer not null,
  public_available boolean not null default true,
  admin_import_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_catalog_event_code_unique unique (event_id, code),
  constraint package_catalog_code_check check (code ~ '^[a-z0-9-]{3,64}$'),
  constraint package_catalog_name_check check (char_length(btrim(display_name)) between 3 and 160),
  constraint package_catalog_type_check check (allocation_type in ('fourball', 'hole_sponsorship')),
  constraint package_catalog_price_check check (price_zar >= 0),
  constraint package_catalog_sort_check check (sort_order >= 0)
);

create table public.host_companies (
  id uuid primary key default extensions.gen_random_uuid(),
  company_reference text,
  company_name text not null,
  contact_first_name text not null,
  contact_surname text not null,
  contact_email text not null,
  mobile text not null,
  internal_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint host_companies_reference_check check (
    company_reference is null or char_length(btrim(company_reference)) between 2 and 80
  ),
  constraint host_companies_name_check check (char_length(btrim(company_name)) between 2 and 180),
  constraint host_companies_first_name_check check (char_length(btrim(contact_first_name)) between 1 and 100),
  constraint host_companies_surname_check check (char_length(btrim(contact_surname)) between 1 and 100),
  constraint host_companies_email_normalised_check check (contact_email = lower(btrim(contact_email))),
  constraint host_companies_email_shape_check check (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint host_companies_mobile_check check (char_length(btrim(mobile)) between 7 and 40)
);

create unique index host_companies_reference_unique_idx
  on public.host_companies (lower(company_reference))
  where company_reference is not null;
create index host_companies_contact_email_idx on public.host_companies (lower(contact_email));

create table public.host_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null unique references public.host_companies(id) on delete cascade,
  login_email text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  account_status text not null default 'pending_review',
  invited_at timestamptz,
  last_access_sent_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint host_accounts_email_normalised_check check (login_email = lower(btrim(login_email))),
  constraint host_accounts_email_shape_check check (login_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint host_accounts_status_check check (
    account_status in ('pending_review', 'invited', 'active', 'suspended', 'deactivated')
  )
);

create unique index host_accounts_login_email_unique_idx on public.host_accounts (lower(login_email));
create index host_accounts_auth_user_idx on public.host_accounts (auth_user_id) where auth_user_id is not null;

create table public.host_bookings (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.host_companies(id) on delete cascade,
  event_id uuid not null references public.golf_events(id) on delete cascade,
  booking_reference text,
  status text not null default 'confirmed',
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint host_bookings_company_event_unique unique (company_id, event_id),
  constraint host_bookings_reference_check check (
    booking_reference is null or char_length(btrim(booking_reference)) between 2 and 80
  ),
  constraint host_bookings_status_check check (status in ('confirmed', 'pending', 'cancelled'))
);

create index host_bookings_company_idx on public.host_bookings (company_id);
create index host_bookings_event_idx on public.host_bookings (event_id);
create unique index host_bookings_event_reference_unique_idx
  on public.host_bookings (event_id, lower(booking_reference))
  where booking_reference is not null;

create table public.booking_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  booking_id uuid not null references public.host_bookings(id) on delete cascade,
  event_id uuid not null references public.golf_events(id) on delete cascade,
  package_id uuid not null references public.package_catalog(id) on delete restrict,
  allocation_type text not null,
  allocation_number integer not null default 1,
  hole_number smallint,
  status text not null default 'active',
  price_zar integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_allocations_type_check check (allocation_type in ('fourball', 'hole_sponsorship')),
  constraint booking_allocations_number_check check (allocation_number > 0),
  constraint booking_allocations_hole_check check (hole_number is null or hole_number between 1 and 18),
  constraint booking_allocations_status_check check (status in ('active', 'cancelled')),
  constraint booking_allocations_price_check check (price_zar >= 0),
  constraint booking_allocations_booking_number_unique unique (booking_id, allocation_type, allocation_number)
);

create index booking_allocations_booking_idx on public.booking_allocations (booking_id);
create index booking_allocations_event_idx on public.booking_allocations (event_id);
create index booking_allocations_package_idx on public.booking_allocations (package_id);
create unique index booking_allocations_active_hole_unique_idx
  on public.booking_allocations (event_id, hole_number)
  where allocation_type = 'hole_sponsorship' and status = 'active' and hole_number is not null;

create table public.fourball_players (
  id uuid primary key default extensions.gen_random_uuid(),
  allocation_id uuid not null references public.booking_allocations(id) on delete cascade,
  slot_number smallint not null,
  first_name text,
  surname text,
  email text,
  mobile text,
  handicap text,
  dietary_requirement text not null default 'None',
  dietary_other text,
  accessibility_notes text,
  admin_notes text,
  popia_acknowledged_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fourball_players_slot_unique unique (allocation_id, slot_number),
  constraint fourball_players_slot_check check (slot_number between 1 and 4),
  constraint fourball_players_email_check check (
    email is null or lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint fourball_players_dietary_check check (
    dietary_requirement in ('None', 'Vegetarian', 'Vegan', 'Halaal', 'Kosher', 'Gluten-free', 'Other')
  ),
  constraint fourball_players_other_check check (
    dietary_requirement = 'Other' or dietary_other is null
  )
);

create index fourball_players_allocation_idx on public.fourball_players (allocation_id);

create table public.host_import_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  file_name text not null,
  file_sha256 text not null,
  status text not null default 'previewed',
  uploaded_by_admin_id bigint references public.m2m_admin_users(id) on delete set null,
  uploaded_by_admin_email text not null,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  additions integer not null default 0,
  updates integer not null default 0,
  duplicates integer not null default 0,
  hole_conflicts integer not null default 0,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint host_import_batches_file_name_check check (char_length(btrim(file_name)) between 1 and 255),
  constraint host_import_batches_hash_check check (file_sha256 ~ '^[a-f0-9]{64}$'),
  constraint host_import_batches_status_check check (status in ('previewed', 'committed', 'rejected', 'failed')),
  constraint host_import_batches_counts_check check (
    total_rows >= 0 and valid_rows >= 0 and invalid_rows >= 0 and additions >= 0 and updates >= 0 and duplicates >= 0 and hole_conflicts >= 0
  )
);

create index host_import_batches_created_idx on public.host_import_batches (created_at desc);

create table public.host_import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.host_import_batches(id) on delete cascade,
  row_number integer not null,
  action text not null,
  is_valid boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  parsed_data jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  matched_company_id uuid references public.host_companies(id) on delete set null,
  applied_company_id uuid references public.host_companies(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint host_import_rows_batch_row_unique unique (batch_id, row_number),
  constraint host_import_rows_number_check check (row_number > 0),
  constraint host_import_rows_action_check check (action in ('add', 'update', 'duplicate', 'invalid', 'conflict')),
  constraint host_import_rows_json_check check (
    jsonb_typeof(raw_data) = 'object'
    and jsonb_typeof(parsed_data) = 'object'
    and jsonb_typeof(errors) = 'array'
    and jsonb_typeof(warnings) = 'array'
  )
);

create index host_import_rows_batch_idx on public.host_import_rows (batch_id);
create index host_import_rows_matched_company_idx on public.host_import_rows (matched_company_id) where matched_company_id is not null;

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  administrator_id bigint references public.m2m_admin_users(id) on delete set null,
  administrator_email text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_log_action_check check (char_length(btrim(action)) between 2 and 100),
  constraint admin_audit_log_entity_check check (char_length(btrim(entity_type)) between 2 and 100),
  constraint admin_audit_log_json_check check (
    (before_data is null or jsonb_typeof(before_data) = 'object')
    and (after_data is null or jsonb_typeof(after_data) = 'object')
    and jsonb_typeof(metadata) = 'object'
  )
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_entity_idx on public.admin_audit_log (entity_type, entity_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'host-import-staging',
  'host-import-staging',
  false,
  5242880,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.m2m_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.m2m_set_updated_at() from public, anon, authenticated;
grant execute on function public.m2m_set_updated_at() to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'golf_events', 'package_catalog', 'host_companies', 'host_accounts',
    'host_bookings', 'booking_allocations', 'fourball_players'
  ] loop
    execute format('drop trigger if exists m2m_set_updated_at on public.%I', table_name);
    execute format(
      'create trigger m2m_set_updated_at before update on public.%I for each row execute function public.m2m_set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

-- All import rows for a batch are validated again and applied within this one
-- transaction. Only the server-side service role may invoke it.
create or replace function public.m2m_commit_host_import(
  p_batch_id uuid,
  p_administrator_id bigint,
  p_administrator_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.golf_events%rowtype;
  import_row public.host_import_rows%rowtype;
  data jsonb;
  company_id_value uuid;
  allocation_id_value uuid;
  reference_match uuid;
  email_match uuid;
  booking_id_value uuid;
  fourball_package public.package_catalog%rowtype;
  sponsorship_package public.package_catalog%rowtype;
  fourball_count integer;
  allocation_index integer;
  sponsorship_code text;
  requested_hole smallint;
  existing_fourballs integer;
  existing_sponsorships integer;
  company_count integer := 0;
  allocation_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m2m-host-import:' || p_batch_id::text, 0));

  if not exists (
    select 1 from public.host_import_batches
    where id = p_batch_id and status = 'previewed'
    for update
  ) then
    raise exception using errcode = 'P0001', message = 'm2m_import_not_ready';
  end if;

  if exists (
    select 1 from public.host_import_rows
    where batch_id = p_batch_id and not is_valid
  ) then
    raise exception using errcode = 'P0001', message = 'm2m_import_contains_invalid_rows';
  end if;

  select * into event_row
  from public.golf_events
  where event_code = 'm2m-invitational-2026'
  for share;

  if event_row.id is null then
    raise exception using errcode = 'P0001', message = 'm2m_event_missing';
  end if;

  select * into fourball_package
  from public.package_catalog
  where event_id = event_row.id and code = 'fourball';

  for import_row in
    select * from public.host_import_rows
    where batch_id = p_batch_id and is_valid
    order by row_number
  loop
    data := import_row.parsed_data;
    reference_match := null;
    email_match := null;

    if nullif(data->>'companyReference', '') is not null then
      select id into reference_match
      from public.host_companies
      where lower(company_reference) = lower(data->>'companyReference')
      for update;
    end if;

    select id into email_match
    from public.host_companies
    where lower(contact_email) = lower(data->>'contactEmail')
    order by created_at
    limit 1
    for update;

    if reference_match is not null and email_match is not null and reference_match <> email_match then
      raise exception using errcode = '23505', message = 'm2m_company_match_conflict';
    end if;

    company_id_value := coalesce(reference_match, email_match);

    if company_id_value is null then
      insert into public.host_companies (
        company_reference, company_name, contact_first_name, contact_surname,
        contact_email, mobile, internal_notes
      ) values (
        nullif(data->>'companyReference', ''), data->>'companyName',
        data->>'contactFirstName', data->>'contactSurname',
        lower(data->>'contactEmail'), data->>'mobile', nullif(data->>'internalNotes', '')
      ) returning id into company_id_value;
    else
      if exists (
        select 1
        from public.host_accounts account
        where account.company_id = company_id_value
          and account.auth_user_id is not null
          and lower(account.login_email) <> lower(data->>'contactEmail')
      ) then
        raise exception using errcode = 'P0001', message = 'm2m_active_login_email_requires_manual_update';
      end if;
      update public.host_companies
      set company_reference = coalesce(nullif(data->>'companyReference', ''), company_reference),
          company_name = data->>'companyName',
          contact_first_name = data->>'contactFirstName',
          contact_surname = data->>'contactSurname',
          contact_email = lower(data->>'contactEmail'),
          mobile = data->>'mobile',
          internal_notes = nullif(data->>'internalNotes', ''),
          is_active = true
      where id = company_id_value;
    end if;

    insert into public.host_accounts (company_id, login_email, account_status)
    values (company_id_value, lower(data->>'contactEmail'), 'pending_review')
    on conflict (company_id) do update
      set login_email = excluded.login_email,
          account_status = case
            when public.host_accounts.account_status in ('active', 'invited') then public.host_accounts.account_status
            else 'pending_review'
          end;

    insert into public.host_bookings (company_id, event_id, booking_reference, internal_notes)
    values (
      company_id_value, event_row.id, nullif(data->>'bookingReference', ''),
      nullif(data->>'internalNotes', '')
    )
    on conflict (company_id, event_id) do update
      set booking_reference = coalesce(excluded.booking_reference, public.host_bookings.booking_reference),
          internal_notes = excluded.internal_notes,
          status = 'confirmed'
    returning id into booking_id_value;

    fourball_count := greatest(0, coalesce((data->>'fourballQuantity')::integer, 0));
    if fourball_count > 20 then
      raise exception using errcode = '22003', message = 'm2m_fourball_quantity_too_large';
    end if;

    select count(*) into existing_fourballs
    from public.booking_allocations
    where booking_id = booking_id_value
      and allocation_type = 'fourball'
      and status = 'active';

    if fourball_count < existing_fourballs then
      raise exception using errcode = 'P0001', message = 'm2m_import_would_remove_fourballs';
    end if;

    update public.booking_allocations
    set package_id = fourball_package.id,
        price_zar = fourball_package.price_zar
    where booking_id = booking_id_value
      and allocation_type = 'fourball'
      and status = 'active';

    for allocation_index in (existing_fourballs + 1)..fourball_count loop
      insert into public.booking_allocations (
        booking_id, event_id, package_id, allocation_type, allocation_number, price_zar
      ) values (
        booking_id_value, event_row.id, fourball_package.id, 'fourball', allocation_index, fourball_package.price_zar
      ) returning id into allocation_id_value;

      insert into public.fourball_players (allocation_id, slot_number)
      select allocation_id_value, slot_number from generate_series(1, 4) slot_number;
      allocation_count := allocation_count + 1;
    end loop;

    sponsorship_code := nullif(data->>'sponsorshipType', '');
    select count(*) into existing_sponsorships
    from public.booking_allocations
    where booking_id = booking_id_value
      and allocation_type = 'hole_sponsorship'
      and status = 'active';

    if (sponsorship_code is null or sponsorship_code = 'none') and existing_sponsorships > 0 then
      raise exception using errcode = 'P0001', message = 'm2m_import_would_remove_sponsorship';
    end if;

    if sponsorship_code is not null and sponsorship_code <> 'none' then
      select * into sponsorship_package
      from public.package_catalog
      where event_id = event_row.id
        and code = sponsorship_code
        and allocation_type = 'hole_sponsorship'
        and admin_import_available;

      if sponsorship_package.id is null then
        raise exception using errcode = '22023', message = 'm2m_invalid_sponsorship_package';
      end if;

      requested_hole := nullif(data->>'holeNumber', '')::smallint;
      insert into public.booking_allocations (
        booking_id, event_id, package_id, allocation_type, allocation_number,
        hole_number, price_zar
      ) values (
        booking_id_value, event_row.id, sponsorship_package.id,
        'hole_sponsorship', 1, requested_hole, sponsorship_package.price_zar
      )
      on conflict (booking_id, allocation_type, allocation_number) do update
        set package_id = excluded.package_id,
            hole_number = excluded.hole_number,
            price_zar = excluded.price_zar,
            status = 'active';
      if existing_sponsorships = 0 then allocation_count := allocation_count + 1; end if;
    end if;

    update public.host_import_rows
    set applied_company_id = company_id_value
    where id = import_row.id;
    company_count := company_count + 1;
  end loop;

  update public.host_import_batches
  set status = 'committed', committed_at = now()
  where id = p_batch_id;

  insert into public.admin_audit_log (
    administrator_id, administrator_email, action, entity_type, entity_id, after_data, metadata
  ) values (
    p_administrator_id, lower(p_administrator_email), 'host_import_committed',
    'host_import_batch', p_batch_id::text,
    jsonb_build_object('companies', company_count, 'allocations', allocation_count),
    jsonb_build_object('source', 'admin_excel_import')
  );

  return jsonb_build_object(
    'batchId', p_batch_id,
    'companies', company_count,
    'allocations', allocation_count,
    'status', 'committed'
  );
end;
$$;

revoke all on function public.m2m_commit_host_import(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.m2m_commit_host_import(uuid, bigint, text) to service_role;

create or replace function public.m2m_save_fourball_players(
  p_allocation_id uuid,
  p_players jsonb,
  p_popia_acknowledged boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  player jsonb;
  target_slot integer;
  updated_count integer := 0;
begin
  if not p_popia_acknowledged then
    raise exception using errcode = '22023', message = 'm2m_popia_acknowledgement_required';
  end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) <> 4 then
    raise exception using errcode = '22023', message = 'm2m_four_player_slots_required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_players) item
    where coalesce(item->>'slotNumber', '') !~ '^[1-4]$'
  ) or (
    select count(distinct item->>'slotNumber')
    from jsonb_array_elements(p_players) item
  ) <> 4 then
    raise exception using errcode = '22023', message = 'm2m_unique_player_slots_required';
  end if;
  if not exists (
    select 1
    from public.booking_allocations allocation
    join public.host_bookings booking on booking.id = allocation.booking_id
    join public.host_accounts account on account.company_id = booking.company_id
    join public.golf_events event on event.id = booking.event_id
    where allocation.id = p_allocation_id
      and allocation.allocation_type = 'fourball'
      and allocation.status = 'active'
      and event.roster_editable
      and account.auth_user_id = (select auth.uid())
      and account.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'm2m_fourball_access_denied';
  end if;

  for player in select value from jsonb_array_elements(p_players) loop
    target_slot := (player->>'slotNumber')::integer;
    if target_slot not between 1 and 4 then
      raise exception using errcode = '22023', message = 'm2m_invalid_player_slot';
    end if;
    update public.fourball_players
    set first_name = nullif(btrim(player->>'firstName'), ''),
        surname = nullif(btrim(player->>'surname'), ''),
        email = nullif(lower(btrim(player->>'email')), ''),
        mobile = nullif(btrim(player->>'mobile'), ''),
        handicap = nullif(btrim(player->>'handicap'), ''),
        dietary_requirement = coalesce(nullif(btrim(player->>'dietaryRequirement'), ''), 'None'),
        dietary_other = case
          when player->>'dietaryRequirement' = 'Other' then nullif(btrim(player->>'dietaryOther'), '')
          else null
        end,
        accessibility_notes = nullif(btrim(player->>'accessibilityNotes'), ''),
        admin_notes = nullif(btrim(player->>'adminNotes'), ''),
        popia_acknowledged_at = now(),
        updated_by = (select auth.uid())
    where allocation_id = p_allocation_id and slot_number = target_slot;
    updated_count := updated_count + 1;
  end loop;

  return jsonb_build_object('allocationId', p_allocation_id, 'updatedPlayers', updated_count);
end;
$$;

revoke all on function public.m2m_save_fourball_players(uuid, jsonb, boolean) from public, anon;
grant execute on function public.m2m_save_fourball_players(uuid, jsonb, boolean) to authenticated, service_role;

-- Browser role access is intentionally narrow. Authenticated host users may
-- read only their own company graph and update only their own player slots.
alter table public.golf_events enable row level security;
alter table public.package_catalog enable row level security;
alter table public.host_companies enable row level security;
alter table public.host_accounts enable row level security;
alter table public.host_bookings enable row level security;
alter table public.booking_allocations enable row level security;
alter table public.fourball_players enable row level security;
alter table public.host_import_batches enable row level security;
alter table public.host_import_rows enable row level security;
alter table public.admin_audit_log enable row level security;

create policy golf_events_host_read on public.golf_events
  for select to authenticated using (portal_open);
create policy package_catalog_host_read on public.package_catalog
  for select to authenticated using (true);
create policy host_companies_member_read on public.host_companies
  for select to authenticated using (
    exists (
      select 1 from public.host_accounts account
      where account.company_id = host_companies.id
        and account.auth_user_id = (select auth.uid())
        and account.account_status in ('invited', 'active')
    )
  );
create policy host_accounts_member_read on public.host_accounts
  for select to authenticated using (
    auth_user_id = (select auth.uid()) and account_status in ('invited', 'active')
  );
create policy host_bookings_member_read on public.host_bookings
  for select to authenticated using (
    exists (
      select 1 from public.host_accounts account
      where account.company_id = host_bookings.company_id
        and account.auth_user_id = (select auth.uid())
        and account.account_status in ('invited', 'active')
    )
  );
create policy booking_allocations_member_read on public.booking_allocations
  for select to authenticated using (
    exists (
      select 1
      from public.host_bookings booking
      join public.host_accounts account on account.company_id = booking.company_id
      where booking.id = booking_allocations.booking_id
        and account.auth_user_id = (select auth.uid())
        and account.account_status in ('invited', 'active')
    )
  );
create policy fourball_players_member_read on public.fourball_players
  for select to authenticated using (
    exists (
      select 1
      from public.booking_allocations allocation
      join public.host_bookings booking on booking.id = allocation.booking_id
      join public.host_accounts account on account.company_id = booking.company_id
      where allocation.id = fourball_players.allocation_id
        and allocation.allocation_type = 'fourball'
        and allocation.status = 'active'
        and account.auth_user_id = (select auth.uid())
        and account.account_status in ('invited', 'active')
    )
  );
create policy fourball_players_member_update on public.fourball_players
  for update to authenticated
  using (
    exists (
      select 1
      from public.booking_allocations allocation
      join public.host_bookings booking on booking.id = allocation.booking_id
      join public.host_accounts account on account.company_id = booking.company_id
      join public.golf_events event on event.id = booking.event_id
      where allocation.id = fourball_players.allocation_id
        and allocation.allocation_type = 'fourball'
        and allocation.status = 'active'
        and event.roster_editable
        and account.auth_user_id = (select auth.uid())
        and account.account_status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.booking_allocations allocation
      join public.host_bookings booking on booking.id = allocation.booking_id
      join public.host_accounts account on account.company_id = booking.company_id
      join public.golf_events event on event.id = booking.event_id
      where allocation.id = fourball_players.allocation_id
        and allocation.allocation_type = 'fourball'
        and allocation.status = 'active'
        and event.roster_editable
        and account.auth_user_id = (select auth.uid())
        and account.account_status = 'active'
    )
  );

revoke all on all tables in schema public from anon, authenticated;
grant select on public.golf_events, public.package_catalog, public.host_companies,
  public.host_accounts, public.host_bookings, public.booking_allocations,
  public.fourball_players to authenticated;
grant update (
  first_name, surname, email, mobile, handicap, dietary_requirement,
  dietary_other, accessibility_notes, admin_notes, popia_acknowledged_at,
  updated_by, updated_at
) on public.fourball_players to authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.golf_events, public.package_catalog,
  public.host_companies, public.host_accounts, public.host_bookings,
  public.booking_allocations, public.fourball_players, public.host_import_batches,
  public.host_import_rows to service_role;
grant select, insert on public.admin_audit_log to service_role;
grant usage, select on sequence public.host_import_rows_id_seq, public.admin_audit_log_id_seq to service_role;

insert into public.golf_events (
  event_code, name, venue, event_date, shotgun_start, portal_message
) values (
  'm2m-invitational-2026', 'M2M Invitational', 'Glendower Golf Club',
  date '2026-09-22', time '10:00',
  'Guest information remains editable throughout the event lifecycle.'
)
on conflict (event_code) do update set
  name = excluded.name,
  venue = excluded.venue,
  event_date = excluded.event_date,
  shotgun_start = excluded.shotgun_start,
  portal_message = excluded.portal_message;

insert into public.package_catalog (
  event_id, code, display_name, allocation_type, price_zar,
  public_available, admin_import_available, sort_order
)
select event.id, package.code, package.display_name, package.allocation_type,
  package.price_zar, package.public_available, true, package.sort_order
from public.golf_events event
cross join (
  values
    ('fourball', 'Fourball', 'fourball', 15000, true, 10),
    ('hole-without-alcohol', 'Hole sponsorship without alcohol', 'hole_sponsorship', 12500, true, 20),
    ('hole-with-alcohol', 'Hole sponsorship with alcohol', 'hole_sponsorship', 17000, false, 30)
) as package(code, display_name, allocation_type, price_zar, public_available, sort_order)
where event.event_code = 'm2m-invitational-2026'
on conflict (event_id, code) do update set
  display_name = excluded.display_name,
  allocation_type = excluded.allocation_type,
  price_zar = excluded.price_zar,
  public_available = excluded.public_available,
  admin_import_available = excluded.admin_import_available,
  sort_order = excluded.sort_order;

comment on table public.host_accounts is 'One host-company portal identity. Auth is provisioned only after an explicit admin release.';
comment on table public.host_import_batches is 'Server-only spreadsheet preview and commit history. Never exposed to browser roles.';
comment on table public.admin_audit_log is 'Append-only service-side audit record for host administration actions.';
comment on column public.booking_allocations.price_zar is 'Fixed catalogue price captured at allocation time; never sourced from spreadsheet formulas.';

notify pgrst, 'reload schema';
;
