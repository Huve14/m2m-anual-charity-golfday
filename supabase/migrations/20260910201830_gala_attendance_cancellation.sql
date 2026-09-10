-- Cancel a whole party (including linked golfers) or one dinner-only guest
-- in one transaction, without deleting their details or golf booking.
create function public.m2m_cancel_gala_attendance(
  p_event_id uuid, p_party_id uuid, p_guest_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  party_guests jsonb;
begin
  select guests into party_guests
  from public.m2m_gala_parties
  where id = p_party_id and event_id = p_event_id
  for update;
  if not found then
    raise exception 'Dinner party not found' using errcode = 'P0002';
  end if;
  if p_guest_id is not null and not exists (
    select 1 from jsonb_array_elements(party_guests) guest
    where guest->>'id' = p_guest_id::text
  ) then
    raise exception 'Dinner guest not found' using errcode = 'P0002';
  end if;
  update public.m2m_gala_parties
  set guests = coalesce((
    select jsonb_agg(case
      when p_guest_id is null or guest->>'id' = p_guest_id::text
      then jsonb_set(guest, '{attendance}', '"declined"'::jsonb)
      else guest end order by position)
    from jsonb_array_elements(party_guests) with ordinality as entries(guest, position)
  ), '[]'::jsonb)
  where id = p_party_id and event_id = p_event_id;
  if p_guest_id is null then
    update public.m2m_gala_players set attendance = 'declined'
    where party_id = p_party_id and event_id = p_event_id;
  end if;
  return p_party_id;
end;
$$;
revoke all on function public.m2m_cancel_gala_attendance(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.m2m_cancel_gala_attendance(uuid, uuid, uuid) to service_role;
