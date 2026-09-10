-- Dinner-only guests are saved atomically with their party. Golfer details remain
-- in m2m_players, so host edits are reflected without copying dietary information.
create table public.m2m_gala_parties (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  table_name text not null default '' check (length(table_name) <= 80),
  guests jsonb not null default '[]' check (jsonb_typeof(guests) = 'array' and jsonb_array_length(guests) <= 100),
  unique (id, event_id)
);
create index m2m_gala_parties_event_idx on public.m2m_gala_parties(event_id);
create table public.m2m_gala_players (
  id uuid primary key,
  event_id uuid not null references public.m2m_events(id) on delete cascade,
  party_id uuid,
  attendance text not null default 'pending' check (attendance in ('pending', 'confirmed', 'declined')),
  foreign key (id, event_id) references public.m2m_players(id, event_id) on delete cascade,
  foreign key (party_id, event_id) references public.m2m_gala_parties(id, event_id)
);
create index m2m_gala_players_event_idx on public.m2m_gala_players(event_id);
create index m2m_gala_players_party_idx on public.m2m_gala_players(party_id, event_id);
alter table public.m2m_gala_parties enable row level security;
alter table public.m2m_gala_players enable row level security;
-- Access is through the authenticated admin API only.
revoke all on public.m2m_gala_parties, public.m2m_gala_players from anon, authenticated;
grant select, insert, update, delete on public.m2m_gala_parties, public.m2m_gala_players to service_role;
