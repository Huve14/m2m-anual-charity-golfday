-- A cancelled fourball is hidden from the tee sheet and must release its start.
create or replace function public.m2m_release_cancelled_fourball_tee_slot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.booking_status = 'cancelled' then
    update public.m2m_tee_slots
    set fourball_id = null
    where event_id = new.event_id and fourball_id = new.id;
  end if;
  return new;
end;
$$;

create trigger m2m_fourballs_release_cancelled_tee_slot
after update of booking_status on public.m2m_fourballs
for each row execute function public.m2m_release_cancelled_fourball_tee_slot();

revoke all on function public.m2m_release_cancelled_fourball_tee_slot() from public, anon, authenticated;
grant execute on function public.m2m_release_cancelled_fourball_tee_slot() to service_role;

-- Repair reservations left behind by earlier individual cancellations.
update public.m2m_tee_slots t
set fourball_id = null
from public.m2m_fourballs f
where t.event_id = f.event_id and t.fourball_id = f.id
  and f.booking_status = 'cancelled';
