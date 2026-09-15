-- Move one physical sponsorship unit without losing its location or changing totals.
create function public.m2m_change_sponsorship_unit_type(p_event uuid,p_unit uuid,p_type uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare u public.m2m_sponsorship_units; c public.m2m_sponsorship_commitments;
 target public.m2m_sponsorship_types; destination uuid; amount integer; prize integer; restricted uuid;
begin
 perform 1 from public.m2m_events where id=p_event for update;
 select * into u from public.m2m_sponsorship_units where id=p_unit and event_id=p_event for update;
 if not found then raise exception 'Sponsorship unit not found' using errcode='P0002'; end if;
 select * into c from public.m2m_sponsorship_commitments where id=u.commitment_id and event_id=p_event for update;
 if c.status='cancelled' then raise exception 'Cannot change a cancelled sponsorship' using errcode='23514'; end if;
 if c.sponsorship_type_id=p_type then return c.id; end if;
 select * into target from public.m2m_sponsorship_types where id=p_type and event_id=p_event and is_active for update;
 if not found or target.category not in ('alcoholic_hole','non_alcoholic_hole','branded_hole') then
  raise exception 'Choose an active hole sponsorship package in this event' using errcode='23514';
 end if;
 if not exists(select 1 from public.m2m_sponsorship_types where id=c.sponsorship_type_id and category in ('alcoholic_hole','non_alcoholic_hole','branded_hole')) then
  raise exception 'Only hole sponsorships can be changed here' using errcode='23514';
 end if;
 if u.hole_slot_id is not null then
  select sponsorship_type_id into restricted from public.m2m_hole_sponsorship_slots where id=u.hole_slot_id and event_id=p_event for update;
  if restricted is not null and restricted<>p_type then
   raise exception 'This position is restricted to another package. Remove the placement first.' using errcode='23514';
  end if;
 end if;
 if c.quantity=1 then
  update public.m2m_sponsorship_commitments set sponsorship_type_id=p_type where id=c.id;
  return c.id;
 end if;
 amount := c.confirmed_amount_minor/c.quantity;
 prize := c.prize_value_minor/c.quantity;
 insert into public.m2m_sponsorship_commitments(event_id,event_company_id,sponsorship_type_id,status,quantity,confirmed_amount_minor,invoice_reference,payment_status,notes,contribution,prize_value_minor)
 values(p_event,c.event_company_id,p_type,c.status,1,amount,c.invoice_reference,c.payment_status,c.notes,c.contribution,prize) returning id into destination;
 -- The insert trigger creates an empty unit; replace it with the original unit.
 delete from public.m2m_sponsorship_units where commitment_id=destination;
 update public.m2m_sponsorship_units set commitment_id=destination,unit_number=1 where id=u.id;
 -- Fill the gap with the last unit before the quantity-sync trigger runs.
 update public.m2m_sponsorship_units set unit_number=u.unit_number where commitment_id=c.id and unit_number=c.quantity and u.unit_number<>c.quantity;
 update public.m2m_sponsorship_commitments set quantity=quantity-1,
  confirmed_amount_minor=confirmed_amount_minor-amount,prize_value_minor=prize_value_minor-prize where id=c.id;
 return destination;
end $$;
revoke all on function public.m2m_change_sponsorship_unit_type(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.m2m_change_sponsorship_unit_type(uuid,uuid,uuid) to service_role;
