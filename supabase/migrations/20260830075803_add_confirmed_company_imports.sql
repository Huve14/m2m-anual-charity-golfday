create table public.m2m_confirmed_import_batches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events (id) on delete cascade,
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  imported_by uuid references public.m2m_profiles (id) on delete set null,
  company_count integer not null default 0,
  fourball_count integer not null default 0,
  sponsorship_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  unique (event_id, file_sha256)
);

create index m2m_confirmed_import_batches_event_idx
  on public.m2m_confirmed_import_batches (event_id, created_at desc);

alter table public.m2m_confirmed_import_batches enable row level security;
alter table public.m2m_confirmed_import_batches force row level security;
revoke all on table public.m2m_confirmed_import_batches from public, anon, authenticated;
grant select, insert on table public.m2m_confirmed_import_batches to service_role;

create or replace function public.m2m_import_confirmed_companies(
  p_event_id uuid,
  p_file_name text,
  p_file_sha256 text,
  p_companies jsonb,
  p_fourball_type_id uuid,
  p_sponsorship_type_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  target_company_id uuid;
  target_event_company_id uuid;
  desired_fourballs integer;
  existing_fourballs integer;
  created_fourball_ids uuid[];
  wants_sponsorship boolean;
  fourball_price integer;
  sponsorship_price integer;
  companies_processed integer := 0;
  fourballs_created integer := 0;
  sponsorships_created integer := 0;
  skipped_fourballs integer := 0;
  skipped_sponsorships integer := 0;
  target_batch_id uuid;
begin
  if jsonb_typeof(p_companies) <> 'array' or jsonb_array_length(p_companies) < 1 or jsonb_array_length(p_companies) > 500 then
    raise exception using errcode = '22023', message = 'm2m_import_companies_invalid';
  end if;
  if p_file_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'm2m_import_hash_invalid';
  end if;

  select price_minor into fourball_price
  from public.m2m_fourball_types
  where id = p_fourball_type_id and event_id = p_event_id and is_active;
  if not found then raise exception using errcode = 'P0002', message = 'm2m_fourball_type_not_found'; end if;

  if p_sponsorship_type_id is not null then
    select price_minor into sponsorship_price
    from public.m2m_sponsorship_types
    where id = p_sponsorship_type_id and event_id = p_event_id and is_active;
    if not found then raise exception using errcode = 'P0002', message = 'm2m_sponsorship_type_not_found'; end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('m2m-confirmed-import:' || p_event_id::text, 0));
  insert into public.m2m_confirmed_import_batches (event_id, file_name, file_sha256, imported_by)
  values (p_event_id, left(btrim(p_file_name), 255), p_file_sha256, p_actor_id)
  returning id into target_batch_id;

  for item in select value from jsonb_array_elements(p_companies)
  loop
    desired_fourballs := greatest(0, least(100, coalesce((item->>'fourballQuantity')::integer, 0)));
    wants_sponsorship := coalesce((item->>'sponsorshipConfirmed')::boolean, false);
    if btrim(coalesce(item->>'companyName', '')) = '' then
      raise exception using errcode = '22023', message = 'm2m_import_company_name_required';
    end if;

    select id into target_company_id from public.m2m_companies
    where lower(btrim(name)) = lower(btrim(item->>'companyName'));
    if not found then
      insert into public.m2m_companies (name, created_by, notes)
      values (btrim(item->>'companyName'), p_actor_id, 'Created from confirmed-list import')
      returning id into target_company_id;
    end if;

    insert into public.m2m_event_companies (
      event_id, company_id, relationship_status, primary_contact_name, primary_contact_email, notes
    ) values (
      p_event_id, target_company_id, 'confirmed', nullif(btrim(coalesce(item->>'contactName', '')), ''),
      nullif(lower(btrim(coalesce(item->>'contactEmail', ''))), ''), 'Confirmed-list import'
    )
    on conflict (event_id, company_id) do update set
      relationship_status = 'confirmed',
      primary_contact_name = coalesce(excluded.primary_contact_name, public.m2m_event_companies.primary_contact_name),
      primary_contact_email = coalesce(excluded.primary_contact_email, public.m2m_event_companies.primary_contact_email)
    returning id into target_event_company_id;

    select count(*) into existing_fourballs
    from public.m2m_fourballs
    where event_id = p_event_id and event_company_id = target_event_company_id
      and fourball_type_id = p_fourball_type_id and booking_status in ('pending', 'confirmed');
    if desired_fourballs > existing_fourballs then
      created_fourball_ids := public.m2m_create_fourball_booking(
        p_event_id, target_event_company_id, p_fourball_type_id,
        desired_fourballs - existing_fourballs, 'confirmed',
        (desired_fourballs - existing_fourballs) * fourball_price,
        btrim(item->>'companyName') || ' – Team', '', 'unpaid',
        'Created from ' || left(btrim(p_file_name), 200), p_actor_id
      );
      fourballs_created := fourballs_created + cardinality(created_fourball_ids);
    elsif desired_fourballs > 0 then
      skipped_fourballs := skipped_fourballs + desired_fourballs;
    end if;

    if wants_sponsorship and p_sponsorship_type_id is not null then
      if not exists (
        select 1 from public.m2m_sponsorship_commitments
        where event_id = p_event_id and event_company_id = target_event_company_id
          and sponsorship_type_id = p_sponsorship_type_id and status in ('reserved', 'confirmed')
      ) then
        insert into public.m2m_sponsorship_commitments (
          event_id, event_company_id, sponsorship_type_id, status, quantity,
          confirmed_amount_minor, payment_status, notes
        ) values (
          p_event_id, target_event_company_id, p_sponsorship_type_id, 'confirmed', 1,
          sponsorship_price, 'unpaid', 'Created from ' || left(btrim(p_file_name), 200)
        );
        sponsorships_created := sponsorships_created + 1;
      else
        skipped_sponsorships := skipped_sponsorships + 1;
      end if;
    end if;
    companies_processed := companies_processed + 1;
  end loop;

  update public.m2m_confirmed_import_batches set
    company_count = companies_processed,
    fourball_count = fourballs_created,
    sponsorship_count = sponsorships_created,
    summary = jsonb_build_object('skippedFourballs', skipped_fourballs, 'skippedSponsorships', skipped_sponsorships)
  where id = target_batch_id;

  insert into public.m2m_audit_events (event_id, actor_profile_id, action, entity_type, entity_id, metadata)
  values (p_event_id, p_actor_id, 'confirmed_list.imported', 'confirmed_import_batch', target_batch_id::text,
    jsonb_build_object('companies', companies_processed, 'fourballsCreated', fourballs_created, 'sponsorshipsCreated', sponsorships_created));

  return jsonb_build_object(
    'batchId', target_batch_id, 'companiesProcessed', companies_processed,
    'fourballsCreated', fourballs_created, 'sponsorshipsCreated', sponsorships_created,
    'skippedFourballs', skipped_fourballs, 'skippedSponsorships', skipped_sponsorships
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'm2m_confirmed_import_already_completed';
end;
$$;

revoke all on function public.m2m_import_confirmed_companies(uuid, text, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.m2m_import_confirmed_companies(uuid, text, text, jsonb, uuid, uuid, uuid) to service_role;
