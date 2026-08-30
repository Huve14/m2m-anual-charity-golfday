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

  if not exists (
    select 1 from public.m2m_event_companies
    where id = p_event_company_id and event_id = p_event_id
  ) then
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

    created_ids := array_append(created_ids, target_fourball_id);
  end loop;

  insert into public.m2m_audit_events (
    event_id, actor_profile_id, action, entity_type, entity_id, metadata
  ) values (
    p_event_id, p_actor_id, 'fourball.bulk_created', 'fourball_type', p_fourball_type_id::text,
    jsonb_build_object('quantity', p_quantity, 'fourballIds', created_ids)
  );

  return created_ids;
end;
$$;

revoke all on function public.m2m_create_fourball_booking(uuid, uuid, uuid, integer, text, integer, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.m2m_create_fourball_booking(uuid, uuid, uuid, integer, text, integer, text, text, text, text, uuid) to service_role;
