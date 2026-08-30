alter table public.m2m_profiles
  add column if not exists must_change_password boolean not null default false;

alter table public.m2m_profiles
  alter column must_change_password set default true;
