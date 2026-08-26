-- M2M Annual Charity Golf Day registration storage.
-- This script is idempotent so it can create a new table or repair an
-- incomplete existing table without deleting registration data.

create extension if not exists pgcrypto;

create table if not exists public.m2m_registrations (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique,
  submitted_at timestamptz not null default now(),
  status text not null default 'New',
  status_source text not null default 'website',
  source text not null default 'website',
  user_id uuid references auth.users (id) on delete set null,
  username text not null,
  account_status text not null default 'pending_secure_invite',
  email text not null,
  first_name text,
  surname text,
  contact_name text not null,
  company text,
  phone text,
  package_choice text not null,
  sponsorship_option text not null default '',
  sponsorship_label text not null default 'No hole sponsorship',
  sponsorship_amount integer not null default 0,
  fourball_count integer not null,
  fourball_amount integer not null default 0,
  player_slots integer not null,
  player_names_text text,
  players jsonb not null default '[]'::jsonb,
  dietary_requirements text,
  dietary_other text,
  notes text,
  privacy_notice_version text,
  registration_consent boolean not null default false,
  player_data_consent boolean not null default false,
  marketing_consent boolean not null default false,
  consented_at timestamptz,
  consent_source text not null default 'website',
  consent_tags jsonb not null default '[]'::jsonb,
  consent_text_snapshot jsonb not null default '{}'::jsonb,
  total_amount integer not null default 0,
  raw_registration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint m2m_registrations_fourball_count_check
    check (fourball_count between 1 and 6),
  constraint m2m_registrations_player_slots_check
    check (player_slots = fourball_count * 4),
  constraint m2m_registrations_amounts_check
    check (
      sponsorship_amount >= 0
      and fourball_amount >= 0
      and total_amount = sponsorship_amount + fourball_amount
    ),
  constraint m2m_registrations_players_array_check
    check (jsonb_typeof(players) = 'array'),
  constraint m2m_registrations_raw_object_check
    check (jsonb_typeof(raw_registration) = 'object'),
  constraint m2m_registrations_consent_tags_array_check
    check (jsonb_typeof(consent_tags) = 'array'),
  constraint m2m_registrations_consent_snapshot_object_check
    check (jsonb_typeof(consent_text_snapshot) = 'object'),
  constraint m2m_registrations_consent_state_check
    check (
      (
        registration_consent
        and player_data_consent
        and privacy_notice_version is not null
        and consented_at is not null
      )
      or (
        not registration_consent
        and not player_data_consent
        and not marketing_consent
        and privacy_notice_version is null
        and consented_at is null
      )
    ),
  constraint m2m_registrations_marketing_consent_check
    check (not marketing_consent or registration_consent)
);

-- Repair columns when an older or partial table already exists.
alter table public.m2m_registrations
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists status text not null default 'New',
  add column if not exists status_source text not null default 'website',
  add column if not exists source text not null default 'website',
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists username text,
  add column if not exists account_status text not null default 'pending_secure_invite',
  add column if not exists email text,
  add column if not exists first_name text,
  add column if not exists surname text,
  add column if not exists contact_name text,
  add column if not exists company text,
  add column if not exists phone text,
  add column if not exists package_choice text,
  add column if not exists sponsorship_option text not null default '',
  add column if not exists sponsorship_label text not null default 'No hole sponsorship',
  add column if not exists sponsorship_amount integer not null default 0,
  add column if not exists fourball_count integer,
  add column if not exists fourball_amount integer not null default 0,
  add column if not exists player_slots integer,
  add column if not exists player_names_text text,
  add column if not exists players jsonb not null default '[]'::jsonb,
  add column if not exists dietary_requirements text,
  add column if not exists dietary_other text,
  add column if not exists notes text,
  add column if not exists privacy_notice_version text,
  add column if not exists registration_consent boolean not null default false,
  add column if not exists player_data_consent boolean not null default false,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists consented_at timestamptz,
  add column if not exists consent_source text not null default 'website',
  add column if not exists consent_tags jsonb not null default '[]'::jsonb,
  add column if not exists consent_text_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists total_amount integer not null default 0,
  add column if not exists raw_registration jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.m2m_registrations
set account_status = 'pending_secure_invite'
where account_status is null;

alter table public.m2m_registrations
  alter column account_status set default 'pending_secure_invite',
  alter column account_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'm2m_registrations_consent_tags_array_check'
      and conrelid = 'public.m2m_registrations'::regclass
  ) then
    alter table public.m2m_registrations
      add constraint m2m_registrations_consent_tags_array_check
      check (jsonb_typeof(consent_tags) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'm2m_registrations_consent_snapshot_object_check'
      and conrelid = 'public.m2m_registrations'::regclass
  ) then
    alter table public.m2m_registrations
      add constraint m2m_registrations_consent_snapshot_object_check
      check (jsonb_typeof(consent_text_snapshot) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'm2m_registrations_consent_state_check'
      and conrelid = 'public.m2m_registrations'::regclass
  ) then
    alter table public.m2m_registrations
      add constraint m2m_registrations_consent_state_check
      check (
        (
          registration_consent
          and player_data_consent
          and privacy_notice_version is not null
          and consented_at is not null
        )
        or (
          not registration_consent
          and not player_data_consent
          and not marketing_consent
          and privacy_notice_version is null
          and consented_at is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'm2m_registrations_marketing_consent_check'
      and conrelid = 'public.m2m_registrations'::regclass
  ) then
    alter table public.m2m_registrations
      add constraint m2m_registrations_marketing_consent_check
      check (not marketing_consent or registration_consent);
  end if;
end $$;

create index if not exists m2m_registrations_email_idx
  on public.m2m_registrations (lower(email));

create index if not exists m2m_registrations_username_idx
  on public.m2m_registrations (username);

create index if not exists m2m_registrations_user_id_idx
  on public.m2m_registrations (user_id)
  where user_id is not null;

create index if not exists m2m_registrations_submitted_at_idx
  on public.m2m_registrations (submitted_at desc);

alter table public.m2m_registrations enable row level security;
alter table public.m2m_registrations force row level security;

-- The public form writes through a Vercel server function using the service
-- role. Browsers and signed-in registrants do not receive direct table access.
revoke all on table public.m2m_registrations from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.m2m_registrations to service_role;

drop policy if exists "service-role-only" on public.m2m_registrations;

comment on table public.m2m_registrations is
  'Private M2M Golf Day registration data. Accessible only to trusted backend services.';

-- Refresh PostgREST immediately after the table or columns change.
notify pgrst, 'reload schema';
