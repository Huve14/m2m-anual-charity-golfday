-- Extend existing placements so suppliers and other sponsors can use venue areas.
alter table public.m2m_sponsorship_types drop constraint m2m_sponsorship_types_category_check;
alter table public.m2m_sponsorship_types add constraint m2m_sponsorship_types_category_check
  check (category in ('alcoholic_hole', 'non_alcoholic_hole', 'branded_hole', 'supplier', 'other'));
alter table public.m2m_sponsorship_commitments add column contribution text not null default ''
  check (char_length(contribution) <= 2000);
alter table public.m2m_hole_sponsorship_slots alter column hole_id drop not null;
alter table public.m2m_hole_sponsorship_slots add column location_name text;
alter table public.m2m_hole_sponsorship_slots add constraint m2m_position_location_check check (
  (hole_id is not null and location_name is null)
  or (hole_id is null and location_name is not null and char_length(btrim(location_name)) between 1 and 120)
);
create unique index m2m_venue_position_unique on public.m2m_hole_sponsorship_slots
  (event_id, lower(btrim(location_name)), lower(btrim(label))) where hole_id is null;

-- Preserve hole-only packages while allowing optional venue placement for others.
create function public.m2m_guard_sponsorship_location() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.hole_slot_id is not null and exists (
    select 1 from public.m2m_sponsorship_commitments c
    join public.m2m_sponsorship_types t on t.id = c.sponsorship_type_id
    join public.m2m_hole_sponsorship_slots s on s.id = new.hole_slot_id
    where c.id = new.commitment_id and t.requires_hole and s.hole_id is null
  ) then
    raise exception using errcode = '23514', message = 'This sponsorship requires a numbered hole.';
  end if;
  return new;
end;
$$;
create trigger m2m_sponsorship_units_guard_location before insert or update of hole_slot_id, commitment_id
  on public.m2m_sponsorship_units for each row execute function public.m2m_guard_sponsorship_location();
revoke all on function public.m2m_guard_sponsorship_location() from public, anon, authenticated;

-- Booking and optional placement succeed together, including first-time package setup.
create function public.m2m_create_supplier_sponsorship(
  p_event_id uuid, p_event_company_id uuid, p_contribution text,
  p_slot_id uuid default null, p_actor_id uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  supplier_type uuid;
  booking_id uuid;
  unit_id uuid;
begin
  if p_contribution is null or char_length(btrim(p_contribution)) not between 1 and 2000 then
    raise exception using errcode = '23514', message = 'Describe what the supplier is sponsoring.';
  end if;
  insert into public.m2m_sponsorship_types(event_id,name,category,capacity,price_minor,requires_hole)
    values(p_event_id,'Supplier sponsorship','supplier',999,0,false)
    on conflict(event_id,name) do nothing;
  select id into supplier_type from public.m2m_sponsorship_types
    where event_id=p_event_id and name='Supplier sponsorship' and category='supplier' and not requires_hole and is_active;
  if supplier_type is null then
    raise exception using errcode = '23514', message = 'The Supplier sponsorship package is unavailable.';
  end if;
  insert into public.m2m_sponsorship_commitments(event_id,event_company_id,sponsorship_type_id,status,quantity,confirmed_amount_minor,payment_status,contribution)
    values(p_event_id,p_event_company_id,supplier_type,'confirmed',1,0,'waived',btrim(p_contribution)) returning id into booking_id;
  if p_slot_id is not null then
    select id into unit_id from public.m2m_sponsorship_units where commitment_id=booking_id;
    perform public.m2m_allocate_sponsorship_unit(p_event_id,unit_id,p_slot_id,p_actor_id);
  end if;
  return booking_id;
end;
$$;
revoke all on function public.m2m_create_supplier_sponsorship(uuid,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.m2m_create_supplier_sponsorship(uuid,uuid,text,uuid,uuid) to service_role;

create function public.m2m_guard_supplier_contribution() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if btrim(new.contribution) = '' and exists (
    select 1 from public.m2m_sponsorship_types where id=new.sponsorship_type_id and category='supplier'
  ) then
    raise exception using errcode = '23514', message = 'Describe what the supplier is sponsoring.';
  end if;
  return new;
end;
$$;
create trigger m2m_commitments_guard_contribution before insert or update of contribution,sponsorship_type_id
  on public.m2m_sponsorship_commitments for each row execute function public.m2m_guard_supplier_contribution();
revoke all on function public.m2m_guard_supplier_contribution() from public, anon, authenticated;
notify pgrst, 'reload schema';
