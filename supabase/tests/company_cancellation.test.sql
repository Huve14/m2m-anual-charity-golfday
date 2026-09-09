-- Run after migrations, with psql -v ON_ERROR_STOP=1. Synthetic data rolls back.
begin;
do $$
declare
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid();
  company uuid := gen_random_uuid(); ec1 uuid := gen_random_uuid(); ec2 uuid := gen_random_uuid();
  h uuid := gen_random_uuid(); tee uuid := gen_random_uuid(); hole_slot uuid := gen_random_uuid();
  team uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  sponsor_type uuid := gen_random_uuid(); commitment uuid := gen_random_uuid(); sponsor_unit uuid;
begin
  insert into public.m2m_events(id,name,slug) values (e1,'Cancellation test', 'cancel-' || e1), (e2,'Other event', 'cancel-' || e2);
  insert into public.m2m_companies(id,name) values(company,'Synthetic cancellation company');
  insert into public.m2m_event_companies(id,event_id,company_id,relationship_status) values (ec1,e1,company,'confirmed'), (ec2,e2,company,'confirmed');
  insert into public.m2m_event_holes(id,event_id,hole_number,label) values(h,e1,1,'Hole 1');
  insert into public.m2m_fourballs(id,event_id,event_company_id,team_name,booking_status,confirmed_amount_minor,payment_status) values
    (team,e1,ec1,'Test team','confirmed',800000,'paid'), (other_team,e2,ec2,'Other event team','confirmed',0,'unpaid');
  insert into public.m2m_players(event_id,fourball_id,position,full_name) values(e1,team,1,'Retained player');
  insert into public.m2m_tee_slots(id,event_id,hole_id,slot_label,fourball_id) values(tee,e1,h,'A',team);
  insert into public.m2m_sponsorship_types(id,event_id,name,capacity,requires_hole) values(sponsor_type,e1,'Test sponsor',1,true);
  insert into public.m2m_sponsorship_commitments(id,event_id,event_company_id,sponsorship_type_id,status,quantity,confirmed_amount_minor,payment_status) values(commitment,e1,ec1,sponsor_type,'confirmed',1,500000,'paid');
  select id into sponsor_unit from public.m2m_sponsorship_units where commitment_id=commitment;
  insert into public.m2m_hole_sponsorship_slots(id,event_id,hole_id,label) values(hole_slot,e1,h,'Primary');
  perform public.m2m_allocate_sponsorship_unit(e1,sponsor_unit,hole_slot,null);

  -- A company remains active until its last booking is cancelled.
  update public.m2m_fourballs set booking_status='cancelled' where id=team;
  if (select relationship_status from public.m2m_event_companies where id=ec1) <> 'confirmed' then raise exception 'Active sponsorship incorrectly cancelled the company'; end if;
  update public.m2m_fourballs set booking_status='confirmed' where id=team;
  update public.m2m_sponsorship_commitments set status='cancelled' where id=commitment;
  if (select relationship_status from public.m2m_event_companies where id=ec1) <> 'confirmed' then raise exception 'Active fourball incorrectly cancelled the company'; end if;
  update public.m2m_fourballs set booking_status='cancelled' where id=team;
  if (select relationship_status from public.m2m_event_companies where id=ec1) <> 'cancelled' then raise exception 'Last cancellation did not update the company'; end if;
  if (select booking_status from public.m2m_fourballs where id=team) <> 'cancelled' then raise exception 'Fourball not cancelled'; end if;
  if (select status from public.m2m_sponsorship_commitments where id=commitment) <> 'cancelled' then raise exception 'Sponsorship not cancelled'; end if;
  if (select fourball_id from public.m2m_tee_slots where id=tee) is not null then raise exception 'Tee not released'; end if;
  if exists(select 1 from public.m2m_sponsorship_units where id=sponsor_unit and (hole_slot_id is not null or allocated_at is not null or allocated_by is not null)) then raise exception 'Sponsor position not released'; end if;
  if (select booking_status from public.m2m_fourballs where id=other_team) <> 'confirmed' then raise exception 'Another event was changed'; end if;
  if (select confirmed_amount_minor from public.m2m_fourballs where id=team) <> 800000 or (select payment_status from public.m2m_fourballs where id=team) <> 'paid' then raise exception 'Payment history changed'; end if;
  if not exists(select 1 from public.m2m_players where fourball_id=team and full_name='Retained player') then raise exception 'Player history lost'; end if;

  begin
    insert into public.m2m_fourballs(event_id,event_company_id,team_name) values(e1,ec1,'Blocked new team');
    raise exception 'Cancelled company accepted new fourball';
  exception when check_violation then
    if sqlerrm <> 'm2m_company_participation_cancelled' then raise; end if;
  end;
  begin
    update public.m2m_sponsorship_commitments set status='confirmed' where id=commitment;
    raise exception 'Cancelled company accepted sponsor reactivation';
  exception when check_violation then
    if sqlerrm <> 'm2m_company_participation_cancelled' then raise; end if;
  end;
  update public.m2m_event_companies set relationship_status='confirmed' where id=ec1;
  if (select booking_status from public.m2m_fourballs where id=team) <> 'cancelled' then raise exception 'Company reactivation restored booking'; end if;
  if (select status from public.m2m_sponsorship_commitments where id=commitment) <> 'cancelled' then raise exception 'Company reactivation restored sponsor'; end if;

  -- Simulate the old cancellation behavior and verify the migration's repair.
  update public.m2m_fourballs set booking_status='confirmed' where id=team;
  update public.m2m_sponsorship_commitments set status='confirmed' where id=commitment;
  update public.m2m_tee_slots set fourball_id=team where id=tee;
  perform public.m2m_allocate_sponsorship_unit(e1,sponsor_unit,hole_slot,null);
  alter table public.m2m_event_companies disable trigger m2m_event_companies_cancel_participation;
  update public.m2m_event_companies set relationship_status='cancelled' where id=ec1;
  alter table public.m2m_event_companies enable trigger m2m_event_companies_cancel_participation;
  update public.m2m_event_companies set relationship_status='cancelled' where id=ec1;
  if (select booking_status from public.m2m_fourballs where id=team) <> 'cancelled' or (select fourball_id from public.m2m_tee_slots where id=tee) is not null then raise exception 'Historical cancellation repair failed'; end if;
  if (select status from public.m2m_sponsorship_commitments where id=commitment) <> 'cancelled' or (select hole_slot_id from public.m2m_sponsorship_units where id=sponsor_unit) is not null then raise exception 'Historical sponsorship repair failed'; end if;
end;
$$;
rollback;
