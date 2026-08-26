-- Private administrator accounts for the M2M Golf Day dashboard.
-- Passwords are stored only as uniquely salted scrypt hashes. The website
-- accesses this table exclusively through authenticated Vercel server routes.

create table if not exists public.m2m_admin_users (
  id bigint generated always as identity primary key,
  email text not null,
  display_name text not null,
  password_hash text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  session_version integer not null default 1,
  last_login_at timestamptz,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint m2m_admin_users_email_length_check
    check (char_length(email) between 3 and 254),
  constraint m2m_admin_users_email_normalised_check
    check (email = lower(btrim(email))),
  constraint m2m_admin_users_email_shape_check
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint m2m_admin_users_display_name_check
    check (char_length(btrim(display_name)) between 2 and 120),
  constraint m2m_admin_users_password_hash_check
    check (
      char_length(password_hash) between 80 and 512
      and password_hash like 'scrypt$16384$8$1$%'
    ),
  constraint m2m_admin_users_role_check
    check (role in ('admin', 'super_admin')),
  constraint m2m_admin_users_session_version_check
    check (session_version > 0)
);

create unique index if not exists m2m_admin_users_email_unique_idx
  on public.m2m_admin_users (lower(email));

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

alter table public.m2m_admin_users enable row level security;
alter table public.m2m_admin_users force row level security;

revoke all on table public.m2m_admin_users from public, anon, authenticated;
revoke all on sequence public.m2m_admin_users_id_seq from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.m2m_admin_users to service_role;
grant usage, select on sequence public.m2m_admin_users_id_seq to service_role;

comment on table public.m2m_admin_users is
  'Private M2M Golf Day dashboard administrators. Backend service access only.';
comment on column public.m2m_admin_users.password_hash is
  'Uniquely salted scrypt password hash. Never returned to the browser.';

notify pgrst, 'reload schema';
