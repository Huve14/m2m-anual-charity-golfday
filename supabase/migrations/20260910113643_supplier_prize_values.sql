-- Donated prize value is independent of cash invoiced or paid. NULL means unvalued.
alter table public.m2m_sponsorship_commitments add column prize_value_minor integer
  check (prize_value_minor >= 0);

create function public.m2m_create_valued_supplier_sponsorship(
  p_event_id uuid, p_event_company_id uuid, p_contribution text, p_prize_value_minor integer,
  p_slot_id uuid default null, p_actor_id uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare booking_id uuid;
begin
  if p_prize_value_minor is null or p_prize_value_minor < 0 then
    raise exception using errcode = '23514', message = 'Prize value must be zero or more.';
  end if;
  booking_id := public.m2m_create_supplier_sponsorship(p_event_id,p_event_company_id,p_contribution,p_slot_id,p_actor_id);
  update public.m2m_sponsorship_commitments set prize_value_minor=p_prize_value_minor
    where id=booking_id and event_id=p_event_id;
  return booking_id;
end;
$$;
revoke all on function public.m2m_create_valued_supplier_sponsorship(uuid,uuid,text,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.m2m_create_valued_supplier_sponsorship(uuid,uuid,text,integer,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
