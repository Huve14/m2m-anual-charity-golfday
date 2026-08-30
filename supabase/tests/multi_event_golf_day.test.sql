begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);
select has_table('public', 'm2m_events', 'events table exists');
select has_table('public', 'm2m_fourballs', 'fourballs table exists');
select has_table('public', 'm2m_sponsorship_commitments', 'sponsorship commitments table exists');
select has_table('public', 'm2m_notification_deliveries', 'delivery ledger exists');
select has_function('public', 'm2m_assign_tee_slot', array['uuid','uuid','uuid','uuid'], 'transactional tee assignment exists');
select has_function('public', 'm2m_submit_fourball', array['uuid','uuid','uuid','text'], 'transactional host submission exists');

insert into public.m2m_events(id,name,slug,venue_name,format,shotgun_start_at,registration_deadline_at,player_deadline_at,rules) values
 ('10000000-0000-0000-0000-000000000001','Event Alpha','event-alpha','Alpha Club','Better Ball','2027-10-20T08:00:00Z','2027-09-01T08:00:00Z','2027-10-01T08:00:00Z','Alpha rules'),
 ('10000000-0000-0000-0000-000000000002','Event Beta','event-beta','Beta Club','Scramble','2025-10-20T08:00:00Z','2025-09-01T08:00:00Z','2025-10-01T08:00:00Z','Beta rules');
insert into public.m2m_event_holes(id,event_id,hole_number,label) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,'Hole 1'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',1,'Hole 1');
insert into public.m2m_companies(id,name) values ('30000000-0000-0000-0000-000000000001','Shared Company');
insert into public.m2m_event_companies(id,event_id,company_id,relationship_status) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','confirmed'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','confirmed');

select throws_ok(
  $$insert into public.m2m_fourballs(event_id,event_company_id,team_name) values ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','Cross Event')$$,
  '23503', null, 'cross-event company relationship is rejected'
);

insert into public.m2m_sponsorship_types(id,event_id,name,capacity,requires_hole)
values ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Branded Hole',2,true);
insert into public.m2m_sponsorship_commitments(id,event_id,event_company_id,sponsorship_type_id,status,quantity)
values ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','confirmed',2);
select is((select count(*)::integer from public.m2m_sponsorship_units where commitment_id='60000000-0000-0000-0000-000000000001'), 2, 'commitment quantity creates purchasable units');
select throws_ok(
  $$insert into public.m2m_sponsorship_commitments(event_id,event_company_id,sponsorship_type_id,status,quantity) values ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','reserved',1)$$,
  '23514', 'm2m_sponsorship_capacity_exceeded', 'reserved inventory cannot oversell capacity'
);
select throws_ok(
  $$update public.m2m_sponsorship_types set capacity=1 where id='50000000-0000-0000-0000-000000000001'$$,
  '23514', 'm2m_sponsorship_capacity_below_committed', 'capacity cannot fall below committed units'
);

insert into public.m2m_hole_sponsorship_slots(id,event_id,hole_id,label,sponsorship_type_id)
values ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Primary','50000000-0000-0000-0000-000000000001');
select public.m2m_allocate_sponsorship_unit(
  '10000000-0000-0000-0000-000000000001',
  (select id from public.m2m_sponsorship_units where commitment_id='60000000-0000-0000-0000-000000000001' and unit_number=2),
  '70000000-0000-0000-0000-000000000001', null
);
select throws_ok(
  $$update public.m2m_sponsorship_commitments set quantity=1 where id='60000000-0000-0000-0000-000000000001'$$,
  '23514', 'm2m_allocated_units_prevent_quantity_reduction', 'allocated units prevent quantity reduction'
);

insert into public.m2m_fourballs(id,event_id,event_company_id,team_name,booking_status) values
 ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Alpha One','confirmed'),
 ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Alpha Two','confirmed'),
 ('80000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','Beta One','confirmed');
insert into public.m2m_players(event_id,fourball_id,position)
select '10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',generate_series(1,4);
insert into public.m2m_players(event_id,fourball_id,position)
select '10000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000003',generate_series(1,4);
insert into public.m2m_tee_slots(id,event_id,hole_id,slot_label) values
 ('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A'),
 ('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','A');
select public.m2m_assign_tee_slot('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',null);
select throws_ok(
  $$select public.m2m_assign_tee_slot('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',null)$$,
  '23505', 'm2m_tee_slot_already_assigned', 'a tee slot cannot be assigned twice'
);
select throws_ok(
  $$select public.m2m_submit_fourball('10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',null,'POPIA-2026-08-20')$$,
  '23514', 'm2m_player_details_incomplete', 'incomplete player lists cannot submit'
);
select throws_ok(
  $$select public.m2m_submit_fourball('10000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000003',null,'POPIA-2026-08-20')$$,
  '23514', 'm2m_player_deadline_passed', 'the player deadline locks outstanding drafts'
);
select is((select fourball_id from public.m2m_tee_slots where id='90000000-0000-0000-0000-000000000001'), '80000000-0000-0000-0000-000000000001'::uuid, 'failed tee reassignment rolls back');

select * from finish();
rollback;
