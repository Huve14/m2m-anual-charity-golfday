create or replace function public.m2m_assign_fourball_host(
  p_event_id uuid,
  p_fourball_id uuid,
  p_profile_id uuid,
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  assignment_id uuid;
begin
  if not exists (
    select 1 from public.m2m_fourballs
    where id = p_fourball_id and event_id = p_event_id
  ) then
    raise exception 'm2m_fourball_not_found';
  end if;

  if not exists (
    select 1 from public.m2m_profiles
    where id = p_profile_id and is_active
  ) then
    raise exception 'm2m_host_not_available';
  end if;

  if p_is_primary then
    update public.m2m_fourball_hosts
    set is_primary = false
    where event_id = p_event_id
      and fourball_id = p_fourball_id
      and profile_id <> p_profile_id
      and is_primary;
  end if;

  insert into public.m2m_fourball_hosts (
    event_id, fourball_id, profile_id, is_primary, invited_at
  ) values (
    p_event_id, p_fourball_id, p_profile_id, p_is_primary, now()
  )
  on conflict (fourball_id, profile_id) do update
  set is_primary = excluded.is_primary,
      invited_at = coalesce(public.m2m_fourball_hosts.invited_at, excluded.invited_at)
  returning id into assignment_id;

  return assignment_id;
end;
$$;

revoke all on function public.m2m_assign_fourball_host(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.m2m_assign_fourball_host(uuid, uuid, uuid, boolean) to service_role;
