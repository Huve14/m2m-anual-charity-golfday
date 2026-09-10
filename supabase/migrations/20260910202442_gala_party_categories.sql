-- Existing dinner-only parties start in Invited guests; golfers are categorised
-- from their player records and remain Fourballs even when linked to a party.
alter table public.m2m_gala_parties
  add column category text not null default 'invited_guest'
  check (category in ('invited_guest', 'staff'));
