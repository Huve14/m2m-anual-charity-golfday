create or replace function public.m2m_protect_final_super_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removing_active_super_admin boolean;
begin
  removing_active_super_admin := false;
  if old.role = 'super_admin' and old.is_active then
    if tg_op = 'DELETE' then
      removing_active_super_admin := true;
    elsif tg_op = 'UPDATE' then
      removing_active_super_admin :=
        new.role <> 'super_admin' or not new.is_active;
    end if;
  end if;

  if removing_active_super_admin then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('m2m_admin_users_active_super_admin', 0)
    );
    if not exists (
      select 1
      from public.m2m_admin_users
      where id <> old.id
        and role = 'super_admin'
        and is_active
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'm2m_last_super_admin';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.m2m_protect_final_super_admin()
  from public, anon, authenticated;
grant execute on function public.m2m_protect_final_super_admin()
  to service_role;
drop trigger if exists m2m_admin_users_protect_final_super_admin
  on public.m2m_admin_users;
create trigger m2m_admin_users_protect_final_super_admin
  before delete or update of role, is_active
  on public.m2m_admin_users
  for each row
  execute function public.m2m_protect_final_super_admin();
grant delete on table public.m2m_admin_users to service_role;
notify pgrst, 'reload schema';
