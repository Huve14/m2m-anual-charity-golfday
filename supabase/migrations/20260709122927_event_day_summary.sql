create or replace function public.get_event_day_containers()
returns table (
  container_key text,
  title text,
  description text,
  metric_label text,
  metric_value text,
  container_tables text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with player_counts as (
    select
      count(*)::integer as total_players,
      count(*) filter (where checked_in)::integer as checked_in_players,
      count(*) filter (where goodie_bag_collected)::integer as goodie_bags_collected,
      count(*) filter (where cart_assigned is not null and cart_assigned <> '')::integer as carts_assigned,
      count(*) filter (where scorecard_printed)::integer as scorecards_printed,
      count(*) filter (where allocation_published)::integer as allocations_published
    from public.player
  ),
  fourball_counts as (
    select
      count(*)::integer as total_fourballs,
      count(*) filter (where tee_or_hole is not null or tee_time is not null)::integer as published_fourballs
    from public.fourball
  ),
  sponsorship_counts as (
    select
      count(*)::integer as total_sponsorships,
      count(*) filter (where fourball_id is not null or status in ('approved', 'confirmed'))::integer as placed_sponsorships
    from public.sponsorship
  ),
  add_on_counts as (
    select
      coalesce(sum(bao.quantity) filter (where ao.code = 'm2m_gifting_pack'), 0)::integer as gifting_packs,
      coalesce(sum(bao.quantity) filter (where ao.code = 'cart_branding'), 0)::integer as cart_branding_units
    from public.booking_add_on bao
    join public.add_on ao on ao.id = bao.add_on_id
  ),
  communication_counts as (
    select
      count(*) filter (where status = 'sent')::integer as sent_messages,
      count(*) filter (where status = 'scheduled')::integer as scheduled_messages
    from public.communication
  )
  select
    'guest_arrival'::text,
    'Guest arrival'::text,
    format(
      '%s of %s players checked in. %s goodie bags collected. %s event messages scheduled or sent.',
      pc.checked_in_players,
      pc.total_players,
      pc.goodie_bags_collected,
      cc.scheduled_messages + cc.sent_messages
    )::text,
    'Checked in'::text,
    format('%s/%s', pc.checked_in_players, pc.total_players)::text,
    array['player', 'player_allocation', 'communication']::text[]
  from player_counts pc
  cross join communication_counts cc

  union all

  select
    'on_course_moments'::text,
    'On-course moments'::text,
    format(
      '%s of %s fourballs have tee or hole details. %s sponsor placements are mapped to holes or approved.',
      fc.published_fourballs,
      fc.total_fourballs,
      sc.placed_sponsorships
    )::text,
    'Fourballs published'::text,
    format('%s/%s', fc.published_fourballs, fc.total_fourballs)::text,
    array['fourball', 'sponsorship', 'sponsorship_package']::text[]
  from fourball_counts fc
  cross join sponsorship_counts sc

  union all

  select
    'experience_inventory'::text,
    'Experience inventory'::text,
    format(
      '%s scorecards printed, %s carts assigned, and %s gifting packs captured for event-day inventory.',
      pc.scorecards_printed,
      pc.carts_assigned,
      ac.gifting_packs
    )::text,
    'Scorecards printed'::text,
    format('%s/%s', pc.scorecards_printed, pc.total_players)::text,
    array['player', 'add_on', 'booking_add_on']::text[]
  from player_counts pc
  cross join add_on_counts ac;
$$;

revoke all on function public.get_event_day_containers() from public;
grant execute on function public.get_event_day_containers() to anon, authenticated;
