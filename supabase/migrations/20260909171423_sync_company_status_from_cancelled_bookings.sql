-- Cancelling the last active booking also ends the company's participation.
-- Companies without bookings, or with any remaining booking, are unchanged.
create or replace function public.m2m_sync_company_cancelled_bookings()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare company_status text;
begin
  if (tg_table_name = 'm2m_fourballs' and to_jsonb(new)->>'booking_status' <> 'cancelled')
    or (tg_table_name = 'm2m_sponsorship_commitments' and to_jsonb(new)->>'status' <> 'cancelled') then
    return new;
  end if;

  select relationship_status into company_status
  from public.m2m_event_companies
  where id = new.event_company_id and event_id = new.event_id
  for update;
  if company_status is null or company_status = 'cancelled' then return new; end if;

  if not exists (select 1 from public.m2m_fourballs where event_company_id = new.event_company_id and event_id = new.event_id and booking_status <> 'cancelled')
    and not exists (select 1 from public.m2m_sponsorship_commitments where event_company_id = new.event_company_id and event_id = new.event_id and status <> 'cancelled') then
    update public.m2m_event_companies set relationship_status = 'cancelled'
    where id = new.event_company_id and event_id = new.event_id;
  end if;
  return new;
end;
$$;

create trigger m2m_fourballs_sync_company_cancellation
after update of booking_status on public.m2m_fourballs
for each row execute function public.m2m_sync_company_cancelled_bookings();
create trigger m2m_sponsorships_sync_company_cancellation
after update of status on public.m2m_sponsorship_commitments
for each row execute function public.m2m_sync_company_cancelled_bookings();

revoke all on function public.m2m_sync_company_cancelled_bookings() from public, anon, authenticated;
grant execute on function public.m2m_sync_company_cancelled_bookings() to service_role;

-- Repair the earlier mismatch (for example, bookings cancelled individually).
update public.m2m_event_companies ec set relationship_status = 'cancelled'
where ec.relationship_status <> 'cancelled'
  and (exists (select 1 from public.m2m_fourballs f where f.event_company_id = ec.id and f.event_id = ec.event_id)
    or exists (select 1 from public.m2m_sponsorship_commitments c where c.event_company_id = ec.id and c.event_id = ec.event_id))
  and not exists (select 1 from public.m2m_fourballs f where f.event_company_id = ec.id and f.event_id = ec.event_id and f.booking_status <> 'cancelled')
  and not exists (select 1 from public.m2m_sponsorship_commitments c where c.event_company_id = ec.id and c.event_id = ec.event_id and c.status <> 'cancelled');

notify pgrst, 'reload schema';
