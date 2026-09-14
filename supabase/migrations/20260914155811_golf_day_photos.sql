-- All photo data is served by capability-aware server endpoints. No direct client grants.
create table public.m2m_photo_settings (
  event_id uuid primary key references public.m2m_events(id) on delete cascade,
  gallery_enabled boolean not null default true,
  uploads_enabled boolean not null default true,
  photo_limit integer not null default 10000 check (photo_limit between 1 and 100000),
  byte_limit bigint not null default 268435456000 check (byte_limit > 0)
);
create table public.m2m_photo_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.m2m_events(id) on delete cascade,
  fourball_id uuid,
  kind text not null check (kind in ('gallery','staff')),
  label text not null default '',
  token_hash text not null unique,
  created_by uuid references public.m2m_profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz,
  rate_started_at timestamptz not null default now(),
  rate_count integer not null default 0,
  unique(id,event_id),
  foreign key(fourball_id,event_id) references public.m2m_fourballs(id,event_id),
  check ((kind='gallery' and fourball_id is not null) or (kind='staff' and fourball_id is null))
);
create index m2m_photo_links_event_idx on public.m2m_photo_links(event_id,created_at);
create table public.m2m_photo_batches (
  id uuid primary key,
  event_id uuid not null references public.m2m_events(id),
  link_id uuid not null,
  created_at timestamptz not null default now(),
  unique(id,event_id),
  foreign key(link_id,event_id) references public.m2m_photo_links(id,event_id)
);
create table public.m2m_photos (
  id uuid primary key,
  event_id uuid not null references public.m2m_events(id),
  batch_id uuid not null,
  link_id uuid not null,
  source text not null check (source in ('gallery','staff')),
  filename text not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 26214400),
  staging_path text not null unique,
  original_path text,
  preview_path text,
  upload_status text not null default 'uploading' check (upload_status in ('uploading','complete')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.m2m_profiles(id),
  unique(id,event_id),
  foreign key(batch_id,event_id) references public.m2m_photo_batches(id,event_id),
  foreign key(link_id,event_id) references public.m2m_photo_links(id,event_id),
  check (status <> 'approved' or upload_status='complete'),
  check (upload_status <> 'complete' or (original_path is not null and preview_path is not null))
);
create index m2m_photos_gallery_idx on public.m2m_photos(event_id,status,created_at desc,id desc);
create index m2m_photos_link_quota_idx on public.m2m_photos(link_id,created_at);
create table public.m2m_photo_fourballs (
  photo_id uuid not null,
  event_id uuid not null,
  fourball_id uuid not null,
  primary key(photo_id,fourball_id),
  foreign key(photo_id,event_id) references public.m2m_photos(id,event_id) on delete cascade,
  foreign key(fourball_id,event_id) references public.m2m_fourballs(id,event_id)
);
create index m2m_photo_fourballs_lookup_idx on public.m2m_photo_fourballs(event_id,fourball_id,photo_id);
alter table public.m2m_photo_settings enable row level security;
alter table public.m2m_photo_links enable row level security;
alter table public.m2m_photo_batches enable row level security;
alter table public.m2m_photos enable row level security;
alter table public.m2m_photo_fourballs enable row level security;
revoke all on public.m2m_photo_settings,public.m2m_photo_links,public.m2m_photo_batches,public.m2m_photos,public.m2m_photo_fourballs from anon,authenticated;
grant all on public.m2m_photo_settings,public.m2m_photo_links,public.m2m_photo_batches,public.m2m_photos,public.m2m_photo_fourballs to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('m2m-photo-staging','m2m-photo-staging',false,26214400,array['image/jpeg','image/png','image/webp']),
 ('m2m-photos','m2m-photos',false,52428800,array['image/jpeg','image/png','image/webp']);
-- No storage.objects policies: only the service role and scoped signed credentials have access.
create function public.m2m_photo_access(p_hash text) returns public.m2m_photo_links
language plpgsql security invoker set search_path='' as $$
declare l public.m2m_photo_links;
begin
 select * into l from public.m2m_photo_links where token_hash=p_hash for update;
 if not found or l.revoked_at is not null or l.expires_at <= now() then raise exception 'photo_link_invalid'; end if;
 if l.rate_started_at < now()-interval '1 minute' then l.rate_count:=0; l.rate_started_at:=now(); end if;
 if l.rate_count >= 240 then raise exception 'photo_rate_limit'; end if;
 update public.m2m_photo_links set rate_count=l.rate_count+1,rate_started_at=l.rate_started_at where id=l.id;
 return l;
end $$;
create function public.m2m_photo_reserve(p_link uuid,p_batch uuid,p_files jsonb,p_fourballs uuid[])
returns setof public.m2m_photos language plpgsql security invoker set search_path='' as $$
declare l public.m2m_photo_links; s public.m2m_photo_settings; f jsonb; pid uuid; n integer; used bigint; bytes bigint;
begin
 select * into l from public.m2m_photo_links where id=p_link for update;
 if not found or l.revoked_at is not null or l.expires_at <= now() then raise exception 'photo_link_invalid'; end if;
 select * into s from public.m2m_photo_settings where event_id=l.event_id for update;
 if not found or not s.uploads_enabled or not s.gallery_enabled then raise exception 'photo_uploads_closed'; end if;
 if exists(select 1 from public.m2m_photo_batches where id=p_batch) then
   if not exists(select 1 from public.m2m_photo_batches where id=p_batch and link_id=l.id) then raise exception 'photo_batch_invalid'; end if;
   return query select * from public.m2m_photos where batch_id=p_batch; return;
 end if;
 n:=jsonb_array_length(p_files);
 if n<1 or n>100 then raise exception 'photo_batch_invalid'; end if;
 if cardinality(p_fourballs)>20 or (l.kind='gallery' and exists(select 1 from unnest(p_fourballs) x where x<>l.fourball_id)) then raise exception 'photo_tags_invalid'; end if;
 if exists(select 1 from unnest(p_fourballs) x where not exists(select 1 from public.m2m_fourballs where id=x and event_id=l.event_id)) then raise exception 'photo_tags_invalid'; end if;
 select count(*),coalesce(sum(byte_size),0) into used,bytes from public.m2m_photos where event_id=l.event_id;
 if used+n>s.photo_limit or bytes+(select sum((x->>'size')::bigint) from jsonb_array_elements(p_files) x)>s.byte_limit then raise exception 'photo_quota_exceeded'; end if;
 select count(*) into used from public.m2m_photos where link_id=l.id and created_at>now()-interval '24 hours';
 if used+n > (case when l.kind='staff' then 2000 else 200 end) then raise exception 'photo_quota_exceeded'; end if;
 select count(*) into used from public.m2m_photo_batches where link_id=l.id and created_at>now()-interval '1 minute';
 if used>=10 then raise exception 'photo_rate_limit'; end if;
 insert into public.m2m_photo_batches(id,event_id,link_id) values(p_batch,l.event_id,l.id);
 for f in select * from jsonb_array_elements(p_files) loop
   pid:=(f->>'id')::uuid;
   insert into public.m2m_photos(id,event_id,batch_id,link_id,source,filename,content_type,byte_size,staging_path)
   values(pid,l.event_id,p_batch,l.id,l.kind,f->>'name',f->>'type',(f->>'size')::bigint,l.event_id::text||'/'||pid::text);
   insert into public.m2m_photo_fourballs(photo_id,event_id,fourball_id) select pid,l.event_id,x from (select distinct unnest(p_fourballs) x) t;
 end loop;
 return query select * from public.m2m_photos where batch_id=p_batch order by created_at,id;
end $$;
create function public.m2m_photo_moderate(p_event uuid,p_ids uuid[],p_actor uuid,p_status text,p_fourballs uuid[] default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status is not null and p_status not in ('pending','approved','rejected') then raise exception 'photo_status_invalid'; end if;
 if cardinality(p_ids)<1 or cardinality(p_ids)>100 then raise exception 'photo_batch_invalid'; end if;
 perform 1 from public.m2m_photos where event_id=p_event and id=any(p_ids) for update;
 if (select count(*) from public.m2m_photos where event_id=p_event and id=any(p_ids) and upload_status='complete')<>cardinality(p_ids) then raise exception 'photo_not_ready'; end if;
 if p_fourballs is not null then
   if cardinality(p_fourballs)>20 or exists(select 1 from unnest(p_fourballs) x where not exists(select 1 from public.m2m_fourballs where id=x and event_id=p_event)) then raise exception 'photo_tags_invalid'; end if;
   delete from public.m2m_photo_fourballs where event_id=p_event and photo_id=any(p_ids);
   insert into public.m2m_photo_fourballs(photo_id,event_id,fourball_id) select p,p_event,f from unnest(p_ids) p cross join (select distinct unnest(p_fourballs) f) t;
 end if;
 if p_status is not null then update public.m2m_photos set status=p_status,reviewed_by=p_actor,reviewed_at=now() where event_id=p_event and id=any(p_ids); end if;
 insert into public.m2m_audit_events(event_id,actor_profile_id,action,entity_type,entity_id,metadata)
 values(p_event,p_actor,'photos.moderated','photo',p_ids[1]::text,jsonb_build_object('photoIds',p_ids,'status',p_status,'fourballIds',p_fourballs));
end $$;
revoke all on function public.m2m_photo_access(text),public.m2m_photo_reserve(uuid,uuid,jsonb,uuid[]),public.m2m_photo_moderate(uuid,uuid[],uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.m2m_photo_access(text),public.m2m_photo_reserve(uuid,uuid,jsonb,uuid[]),public.m2m_photo_moderate(uuid,uuid[],uuid,text,uuid[]) to service_role;
create function public.m2m_photo_retag(p_link uuid,p_photo uuid,p_fourballs uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare l public.m2m_photo_links;
begin
 select * into l from public.m2m_photo_links where id=p_link for update;
 if not found or l.revoked_at is not null or l.expires_at<=now() then raise exception 'photo_link_invalid'; end if;
 perform 1 from public.m2m_photos where id=p_photo and link_id=p_link and status='pending' for update;
 if not found then raise exception 'photo_not_ready'; end if;
 if cardinality(p_fourballs)>20 or (l.kind='gallery' and exists(select 1 from unnest(p_fourballs) x where x<>l.fourball_id)) or exists(select 1 from unnest(p_fourballs) x where not exists(select 1 from public.m2m_fourballs where id=x and event_id=l.event_id)) then raise exception 'photo_tags_invalid'; end if;
 delete from public.m2m_photo_fourballs where photo_id=p_photo;
 insert into public.m2m_photo_fourballs(photo_id,event_id,fourball_id) select p_photo,l.event_id,x from (select distinct unnest(p_fourballs) x) t;
end $$;
revoke all on function public.m2m_photo_retag(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.m2m_photo_retag(uuid,uuid,uuid[]) to service_role;
-- Link creation and replacement are atomic and bounded, including links issued by hosts.
create function public.m2m_photo_issue_link(p_event uuid,p_fourball uuid,p_kind text,p_label text,p_hash text,p_actor uuid,p_replace uuid default null)
returns public.m2m_photo_links language plpgsql security invoker set search_path='' as $$
declare result public.m2m_photo_links; old public.m2m_photo_links; used integer;
begin
 perform 1 from public.m2m_events where id=p_event for update;
 if not found then raise exception 'photo_tags_invalid'; end if;
 if p_replace is not null then
  select * into old from public.m2m_photo_links where id=p_replace and event_id=p_event for update;
  if not found or old.kind<>p_kind or old.fourball_id is distinct from p_fourball then raise exception 'photo_link_invalid'; end if;
 end if;
 select count(*) into used from public.m2m_photo_links where created_by=p_actor and created_at>now()-interval '1 minute';
 if used>=10 then raise exception 'photo_rate_limit'; end if;
 select count(*) into used from public.m2m_photo_links where event_id=p_event and kind=p_kind and fourball_id is not distinct from p_fourball and revoked_at is null and (expires_at is null or expires_at>now()) and (p_replace is null or id<>p_replace);
 if used >= (case when p_kind='staff' then 100 else 20 end) then raise exception 'photo_link_limit'; end if;
 insert into public.m2m_photo_settings(event_id) values(p_event) on conflict do nothing;
 insert into public.m2m_photo_links(event_id,fourball_id,kind,label,token_hash,created_by) values(p_event,p_fourball,p_kind,p_label,p_hash,p_actor) returning * into result;
 if p_replace is not null then update public.m2m_photo_links set revoked_at=now() where id=p_replace; end if;
 return result;
end $$;
revoke all on function public.m2m_photo_issue_link(uuid,uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.m2m_photo_issue_link(uuid,uuid,text,text,text,uuid,uuid) to service_role;
