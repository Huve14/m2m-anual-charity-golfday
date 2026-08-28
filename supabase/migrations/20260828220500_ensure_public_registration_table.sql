create table if not exists public.m2m_registrations (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique,
  submitted_at timestamptz not null default now(),
  status text not null default 'New',
  status_source text not null default 'website',
  source text not null default 'website',
  user_id uuid references auth.users(id) on delete set null,
  username text not null,
  email text not null,
  first_name text,
  surname text,
  contact_name text not null,
  company text,
  phone text,
  package_choice text not null,
  sponsorship_option text not null default '',
  sponsorship_label text not null default 'No hole sponsorship',
  sponsorship_amount integer not null default 0 check (sponsorship_amount >= 0),
  fourball_count integer not null check (fourball_count between 1 and 6),
  fourball_amount integer not null default 0 check (fourball_amount >= 0),
  player_slots integer not null check (player_slots between 4 and 24),
  player_names_text text,
  players jsonb not null default '[]'::jsonb check (jsonb_typeof(players) = 'array'),
  dietary_requirements text,
  dietary_other text,
  notes text,
  total_amount integer not null default 0 check (total_amount >= 0),
  raw_registration jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_registration) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  privacy_notice_version text,
  registration_consent boolean not null default false,
  player_data_consent boolean not null default false,
  marketing_consent boolean not null default false,
  consented_at timestamptz,
  consent_source text not null default 'website',
  consent_tags jsonb not null default '[]'::jsonb check (jsonb_typeof(consent_tags) = 'array'),
  consent_text_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(consent_text_snapshot) = 'object'),
  account_status text not null default 'pending_secure_invite'
);

create index if not exists m2m_registrations_email_idx
  on public.m2m_registrations (lower(email));
create index if not exists m2m_registrations_username_idx
  on public.m2m_registrations (username);
create index if not exists m2m_registrations_submitted_at_idx
  on public.m2m_registrations (submitted_at desc);

alter table public.m2m_registrations enable row level security;

revoke all on public.m2m_registrations from anon, authenticated;
grant select, insert, update, delete on public.m2m_registrations to service_role;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'm2m_registrations_set_updated_at'
      and tgrelid = 'public.m2m_registrations'::regclass
  ) then
    create trigger m2m_registrations_set_updated_at
      before update on public.m2m_registrations
      for each row execute function public.m2m_set_updated_at();
  end if;
end;
$$;

comment on table public.m2m_registrations is
  'Public website enquiries. Browser roles have no direct access; writes are validated by the server API.';
