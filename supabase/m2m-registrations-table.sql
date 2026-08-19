-- M2M Charity Golf Day registration table
-- Run this in your Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.m2m_registrations (
  id uuid primary key default gen_random_uuid(),
  registration_id text not null unique,
  submitted_at timestamptz not null default now(),
  status text not null default 'new',
  status_source text not null default 'website',
  source text not null default 'website',
  user_id uuid references auth.users (id) on delete set null,
  username text not null,
  email text not null,
  first_name text,
  surname text,
  contact_name text not null,
  company text,
  phone text,
  package_choice text not null,
  sponsorship_label text not null default 'No hole sponsorship',
  fourball_count integer not null check (fourball_count >= 1),
  player_slots integer not null,
  player_names_text text,
  dietary_requirements text,
  dietary_other text,
  notes text,
  sponsorship_option text not null default 'No hole sponsorship',
  sponsorship_amount integer not null default 0,
  fourball_amount integer not null default 0,
  total_amount integer not null default 0,
  raw_registration jsonb not null default '{}'::jsonb,
  players jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists m2m_registrations_registration_id_uq
  on public.m2m_registrations (registration_id);

create index if not exists m2m_registrations_email_idx
  on public.m2m_registrations (email);

create index if not exists m2m_registrations_username_idx
  on public.m2m_registrations (username);

alter table public.m2m_registrations enable row level security;

drop policy if exists "service-role-only" on public.m2m_registrations;

create policy "service-role-only" on public.m2m_registrations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
