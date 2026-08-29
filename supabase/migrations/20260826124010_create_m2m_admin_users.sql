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
  constraint m2m_admin_users_email_length_check check (char_length(email) between 3 and 254),
  constraint m2m_admin_users_email_normalised_check check (email = lower(btrim(email))),
  constraint m2m_admin_users_email_shape_check check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint m2m_admin_users_display_name_check check (char_length(btrim(display_name)) between 2 and 120),
  constraint m2m_admin_users_password_hash_check check (
    char_length(password_hash) between 80 and 512
    and password_hash like 'scrypt$16384$8$1$%'
  ),
  constraint m2m_admin_users_role_check check (role in ('admin', 'super_admin')),
  constraint m2m_admin_users_session_version_check check (session_version > 0)
);
create unique index if not exists m2m_admin_users_email_unique_idx
  on public.m2m_admin_users (lower(email));
create index if not exists m2m_admin_users_active_created_idx
  on public.m2m_admin_users (created_at asc)
  where is_active;
alter table public.m2m_admin_users enable row level security;
alter table public.m2m_admin_users force row level security;
revoke all on table public.m2m_admin_users from public, anon, authenticated;
revoke all on sequence public.m2m_admin_users_id_seq from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on table public.m2m_admin_users to service_role;
grant usage, select on sequence public.m2m_admin_users_id_seq to service_role;
comment on table public.m2m_admin_users is
  'Private M2M Golf Day dashboard administrators. Backend service access only.';
comment on column public.m2m_admin_users.password_hash is
  'Uniquely salted scrypt password hash. Never returned to the browser.';
notify pgrst, 'reload schema';
