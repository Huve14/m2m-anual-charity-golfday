-- Separate admin batch allowance; retain the existing individual-link limit.
create table public.m2m_photo_link_batches (
 id text primary key check (id ~ '^[a-f0-9]{64}$'),
 event_id uuid not null references public.m2m_events(id) on delete cascade,
 actor_id uuid not null references public.m2m_profiles(id),
 requests jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.m2m_photo_link_batches enable row level security;
revoke all on public.m2m_photo_link_batches from public,anon,authenticated;
grant all on public.m2m_photo_link_batches to service_role;
create index on public.m2m_photo_link_batches(actor_id,created_at);

create function public.m2m_photo_issue_link_batch(p_id text,p_event uuid,p_actor uuid,p_links jsonb)
returns setof public.m2m_photo_links language plpgsql security invoker set search_path='' as $$
declare previous public.m2m_photo_link_batches; n integer;
begin
 if jsonb_typeof(p_links) is distinct from 'array' then raise exception 'photo_batch_invalid'; end if;
 n := jsonb_array_length(p_links);
 if n<1 or n>500 or p_id is null or p_id !~ '^[a-f0-9]{64}$' then raise exception 'photo_batch_invalid'; end if;
 -- Serialize batches by actor across events and issuance against ordinary links.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,0));
 perform 1 from public.m2m_events where id=p_event for update;
 if not found then raise exception 'photo_tags_invalid'; end if;
 select * into previous from public.m2m_photo_link_batches where id=p_id;
 if found then
  if previous.event_id<>p_event or previous.actor_id<>p_actor or previous.requests<>p_links then raise exception 'photo_batch_invalid'; end if;
 else
  if (select count(*) from jsonb_to_recordset(p_links) as x(fourball_id uuid,token_hash text)
      join public.m2m_fourballs f on f.id=x.fourball_id and f.event_id=p_event
      where x.token_hash ~ '^[a-f0-9]{64}$')<>n
     or (select count(distinct x->>'fourball_id') from jsonb_array_elements(p_links) x)<>n
     or (select count(distinct x->>'token_hash') from jsonb_array_elements(p_links) x)<>n then
   raise exception 'photo_tags_invalid';
  end if;
  if (select count(*) from public.m2m_photo_link_batches where actor_id=p_actor and created_at>now()-interval '1 minute')>=5 then
   raise exception 'photo_batch_rate_limit';
  end if;
  if exists(select 1 from public.m2m_photo_links l
    where l.event_id=p_event and l.kind='gallery' and l.revoked_at is null and (l.expires_at is null or l.expires_at>now())
    and l.fourball_id in(select (x->>'fourball_id')::uuid from jsonb_array_elements(p_links) x)
    group by l.fourball_id having count(*)>=20) then raise exception 'photo_link_limit'; end if;
  insert into public.m2m_photo_settings(event_id) values(p_event) on conflict do nothing;
  insert into public.m2m_photo_link_batches(id,event_id,actor_id,requests) values(p_id,p_event,p_actor,p_links);
  insert into public.m2m_photo_links(event_id,fourball_id,kind,label,token_hash,created_by)
   select p_event,x.fourball_id,'gallery','Cart gallery',x.token_hash,p_actor
   from jsonb_to_recordset(p_links) as x(fourball_id uuid,token_hash text);
  insert into public.m2m_audit_events(event_id,actor_profile_id,action,entity_type,entity_id,metadata)
   values(p_event,p_actor,'photos.links_batch_created','event',p_event::text,jsonb_build_object('count',n));
 end if;
 return query select l.* from public.m2m_photo_links l where l.event_id=p_event
  and l.token_hash in(select x->>'token_hash' from jsonb_array_elements(p_links) x);
end $$;
revoke all on function public.m2m_photo_issue_link_batch(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.m2m_photo_issue_link_batch(text,uuid,uuid,jsonb) to service_role;
