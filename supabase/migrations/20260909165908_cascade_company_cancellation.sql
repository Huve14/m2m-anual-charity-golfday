-- Company participation is authoritative. Keep commercial/player history,
-- but cancel bookings and release course positions in the same transaction.
create or replace function public.m2m_cancel_company_participation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.relationship_status <> 'cancelled' then return new; end if;

  update public.m2m_fourballs
  set booking_status = 'cancelled'
  where event_company_id = new.id and event_id = new.event_id
    and booking_status <> 'cancelled';

  update public.m2m_sponsorship_commitments
  set status = 'cancelled'
  where event_company_id = new.id and event_id = new.event_id
    and status <> 'cancelled';

  update public.m2m_tee_slots t
  set fourball_id = null
  from public.m2m_fourballs f
  where t.fourball_id = f.id and t.event_id = new.event_id
    and f.event_company_id = new.id and f.event_id = new.event_id;

  update public.m2m_sponsorship_units u
  set hole_slot_id = null, allocated_at = null, allocated_by = null
  from public.m2m_sponsorship_commitments c
  where u.commitment_id = c.id and u.event_id = new.event_id
    and c.event_company_id = new.id and c.event_id = new.event_id
    and u.hole_slot_id is not null;
  return new;
end;
$$;

create trigger m2m_event_companies_cancel_participation
after update of relationship_status on public.m2m_event_companies
for each row execute function public.m2m_cancel_company_participation();

-- Prevent new bookings or reactivation while the company remains cancelled.
-- Lock the company row so a concurrent booking cannot escape cancellation.
create or replace function public.m2m_guard_company_participation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare company_status text;
begin
  if (tg_table_name = 'm2m_fourballs' and to_jsonb(new)->>'booking_status' = 'cancelled')
    or (tg_table_name = 'm2m_sponsorship_commitments' and to_jsonb(new)->>'status' = 'cancelled') then
    return new;
  end if;
  select relationship_status into company_status
  from public.m2m_event_companies
  where id = new.event_company_id and event_id = new.event_id
  for share;
  if company_status = 'cancelled' then
    raise exception using errcode = '23514', message = 'm2m_company_participation_cancelled';
  end if;
  return new;
end;
$$;

create trigger m2m_fourballs_guard_company_participation
before insert or update of event_company_id, event_id, booking_status on public.m2m_fourballs
for each row execute function public.m2m_guard_company_participation();
create trigger m2m_sponsorships_guard_company_participation
before insert or update of event_company_id, event_id, status on public.m2m_sponsorship_commitments
for each row execute function public.m2m_guard_company_participation();

revoke all on function public.m2m_cancel_company_participation() from public, anon, authenticated;
revoke all on function public.m2m_guard_company_participation() from public, anon, authenticated;
grant execute on function public.m2m_cancel_company_participation() to service_role;
grant execute on function public.m2m_guard_company_participation() to service_role;

-- Repair companies cancelled before this behavior was introduced.
update public.m2m_event_companies set relationship_status = 'cancelled'
where relationship_status = 'cancelled';

notify pgrst, 'reload schema';
