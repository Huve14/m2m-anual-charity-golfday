create index if not exists m2m_registrations_user_id_idx
  on public.m2m_registrations (user_id)
  where user_id is not null;
