create extension if not exists pgcrypto;

create table if not exists public.config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.booking (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  purchaser_type text not null,
  contact_person text not null,
  contact_email text not null,
  status text not null default 'submitted',
  total_amount numeric(12,2) not null default 0,
  terms_accepted boolean not null default false,
  consent_communication boolean not null default false,
  player_form_token text not null unique,
  rsvp_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.booking_line_item (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.booking(id) on delete cascade,
  item_type text not null,
  quantity integer not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.player_allocation (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.booking(id) on delete cascade,
  slots_purchased integer not null default 0,
  players_allocated integer not null default 0,
  players_submitted integer not null default 0,
  allocation_locked boolean not null default false,
  last_updated_by text not null default 'purchaser',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.player (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.booking(id) on delete cascade,
  name text not null,
  email text not null,
  cell_number text not null,
  handicap text,
  shirt_size text,
  dietary_requirements text not null default 'None',
  cart_required boolean not null default false,
  club_hire_required boolean not null default false,
  comms_opt_in boolean not null default true,
  fourball_id uuid,
  tee_or_hole text,
  tee_time timestamptz,
  allocation_published boolean not null default false,
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  goodie_bag_collected boolean not null default false,
  cart_assigned text,
  scorecard_printed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.fourball (
  id uuid primary key default gen_random_uuid(),
  fourball_number integer not null unique,
  team_name text,
  capacity integer not null default 4,
  tee_or_hole text,
  tee_time timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.sponsorship_package (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price numeric(12,2),
  section_18a_eligible boolean not null default false,
  inventory integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.sponsorship (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.booking(id) on delete cascade,
  package_id uuid not null references public.sponsorship_package(id),
  quantity integer not null default 1,
  amount numeric(12,2) not null default 0,
  logo_file_key text,
  in_kind_description text,
  fourball_id uuid,
  approved_by uuid,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.add_on (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  unit_price numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.booking_add_on (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.booking(id) on delete cascade,
  add_on_id uuid not null references public.add_on(id),
  quantity integer not null default 1,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.booking(id) on delete cascade,
  invoice_number text not null,
  customer_id text,
  amount numeric(12,2) not null default 0,
  file_key text not null,
  status text not null default 'draft',
  uploaded_by uuid,
  approved_by uuid,
  emailed_at timestamptz,
  due_date date,
  paid_at timestamptz,
  section_18a_eligible boolean not null default false,
  section_18a_issued boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table if not exists public.communication (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.booking(id) on delete cascade,
  player_id uuid references public.player(id) on delete cascade,
  channel text not null,
  comm_type text not null,
  status text not null default 'scheduled',
  scheduled_for timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  triggered_by uuid,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

alter table public.config enable row level security;
alter table public.booking enable row level security;
alter table public.booking_line_item enable row level security;
alter table public.player_allocation enable row level security;
alter table public.player enable row level security;
alter table public.fourball enable row level security;
alter table public.sponsorship_package enable row level security;
alter table public.sponsorship enable row level security;
alter table public.add_on enable row level security;
alter table public.booking_add_on enable row level security;
alter table public.invoice enable row level security;
alter table public.communication enable row level security;
alter table public.audit_log enable row level security;

create policy "deny all booking" on public.booking for all using (false) with check (false);
create policy "deny all player" on public.player for all using (false) with check (false);
create policy "deny all invoice" on public.invoice for all using (false) with check (false);

insert into public.config (key, value)
values
  ('price_fourball', '8000.00'::jsonb),
  ('price_player', '2000.00'::jsonb),
  ('players_per_fourball', '4'::jsonb),
  ('event_format', '"shotgun"'::jsonb),
  ('payment_terms_days', '30'::jsonb),
  ('my_fourball_published', 'false'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
