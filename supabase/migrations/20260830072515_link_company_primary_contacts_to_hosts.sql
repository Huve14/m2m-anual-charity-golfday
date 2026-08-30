alter table public.m2m_event_companies
  add column primary_contact_profile_id uuid
  references public.m2m_profiles (id) on delete set null;

create index m2m_event_companies_primary_contact_profile_idx
  on public.m2m_event_companies (primary_contact_profile_id)
  where primary_contact_profile_id is not null;

update public.m2m_event_companies as event_company
set primary_contact_profile_id = profile.id
from public.m2m_profiles as profile
where event_company.primary_contact_profile_id is null
  and event_company.primary_contact_email is not null
  and lower(btrim(event_company.primary_contact_email)) = lower(btrim(profile.email));

update public.m2m_fourball_hosts as host_assignment
set is_primary = true
from public.m2m_fourballs as fourball
join public.m2m_event_companies as event_company
  on event_company.id = fourball.event_company_id
where host_assignment.fourball_id = fourball.id
  and host_assignment.profile_id = event_company.primary_contact_profile_id
  and event_company.primary_contact_profile_id is not null
  and not exists (
    select 1 from public.m2m_fourball_hosts as current_primary
    where current_primary.fourball_id = fourball.id
      and current_primary.is_primary
  );

insert into public.m2m_fourball_hosts (
  event_id, fourball_id, profile_id, is_primary
)
select fourball.event_id, fourball.id, event_company.primary_contact_profile_id, true
from public.m2m_fourballs as fourball
join public.m2m_event_companies as event_company
  on event_company.id = fourball.event_company_id
where event_company.primary_contact_profile_id is not null
  and fourball.booking_status <> 'cancelled'
  and not exists (
    select 1 from public.m2m_fourball_hosts as current_primary
    where current_primary.fourball_id = fourball.id
      and current_primary.is_primary
  )
  and not exists (
    select 1 from public.m2m_fourball_hosts as same_contact
    where same_contact.fourball_id = fourball.id
      and same_contact.profile_id = event_company.primary_contact_profile_id
  );

create or replace function public.m2m_create_fourball_booking(
  p_event_id uuid,
  p_event_company_id uuid,
  p_fourball_type_id uuid,
  p_quantity integer,
  p_booking_status text,
  p_confirmed_amount_minor integer,
  p_team_name_prefix text,
  p_invoice_reference text,
  p_payment_status text,
  p_notes text,
  p_actor_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_row public.m2m_fourball_types%rowtype;
  used_capacity integer;
  contact_profile_id uuid;
  target_fourball_id uuid;
  created_ids uuid[] := array[]::uuid[];
  item_amount integer;
  amount_remainder integer;
begin
  if p_quantity < 1 or p_quantity > 100 then
    raise exception using errcode = '22003', message = 'm2m_fourball_quantity_invalid';
  end if;
  if p_confirmed_amount_minor < 0 then
    raise exception using errcode = '22003', message = 'm2m_fourball_amount_invalid';
  end if;
  if p_booking_status not in ('pending', 'confirmed') then
    raise exception using errcode = '22023', message = 'm2m_fourball_booking_status_invalid';
  end if;
  if p_payment_status not in ('unpaid', 'partial', 'paid', 'waived') then
    raise exception using errcode = '22023', message = 'm2m_fourball_payment_status_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m2m-fourball-type:' || p_fourball_type_id::text, 0)
  );

  select * into type_row
  from public.m2m_fourball_types
  where id = p_fourball_type_id and event_id = p_event_id and is_active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'm2m_fourball_type_not_found';
  end if;

  select primary_contact_profile_id into contact_profile_id
  from public.m2m_event_companies
  where id = p_event_company_id and event_id = p_event_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'm2m_event_company_not_found';
  end if;

  select count(*) into used_capacity
  from public.m2m_fourballs
  where fourball_type_id = p_fourball_type_id
    and booking_status in ('pending', 'confirmed');
  if used_capacity + p_quantity > type_row.capacity then
    raise exception using errcode = 'P0001', message = 'm2m_fourball_capacity_exceeded';
  end if;

  item_amount := p_confirmed_amount_minor / p_quantity;
  amount_remainder := p_confirmed_amount_minor % p_quantity;

  for item_index in 1..p_quantity loop
    insert into public.m2m_fourballs (
      event_id, event_company_id, fourball_type_id, team_name,
      booking_status, unit_price_minor, confirmed_amount_minor,
      invoice_reference, payment_status, notes
    ) values (
      p_event_id, p_event_company_id, p_fourball_type_id,
      btrim(p_team_name_prefix) || case when p_quantity > 1 then ' ' || item_index else '' end,
      p_booking_status, type_row.price_minor,
      item_amount + case when item_index = p_quantity then amount_remainder else 0 end,
      nullif(btrim(p_invoice_reference), ''), p_payment_status, nullif(btrim(p_notes), '')
    ) returning id into target_fourball_id;

    insert into public.m2m_players (event_id, fourball_id, position)
    select p_event_id, target_fourball_id, position
    from generate_series(1, 4) as slots(position);

    if contact_profile_id is not null then
      insert into public.m2m_fourball_hosts (
        event_id, fourball_id, profile_id, is_primary
      ) values (
        p_event_id, target_fourball_id, contact_profile_id, true
      );
    end if;

    created_ids := array_append(created_ids, target_fourball_id);
  end loop;

  insert into public.m2m_audit_events (
    event_id, actor_profile_id, action, entity_type, entity_id, metadata
  ) values (
    p_event_id, p_actor_id, 'fourball.bulk_created', 'fourball_type', p_fourball_type_id::text,
    jsonb_build_object(
      'quantity', p_quantity,
      'fourballIds', created_ids,
      'primaryContactProfileId', contact_profile_id
    )
  );

  return created_ids;
end;
$$;

revoke all on function public.m2m_create_fourball_booking(uuid, uuid, uuid, integer, text, integer, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.m2m_create_fourball_booking(uuid, uuid, uuid, integer, text, integer, text, text, text, text, uuid)
  to service_role;
