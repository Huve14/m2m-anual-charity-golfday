-- Synthetic data, rolled back. Run with psql -v ON_ERROR_STOP=1 after migrations.
begin;
set local role service_role;
do $$
declare
  event_id uuid := gen_random_uuid(); other_event uuid := gen_random_uuid();
  company_id uuid := gen_random_uuid(); ec uuid := gen_random_uuid(); other_ec uuid := gen_random_uuid();
  hole uuid := gen_random_uuid(); hole_slot uuid := gen_random_uuid(); venue_slot uuid := gen_random_uuid();
  booking uuid; unit_id uuid; second_booking uuid; second_unit uuid; hole_type uuid := gen_random_uuid(); hole_booking uuid := gen_random_uuid();
  before_count integer;
begin
  insert into public.m2m_events(id,name,slug) values(event_id,'Supplier test','supplier-'||event_id),(other_event,'Other test','supplier-'||other_event);
  insert into public.m2m_companies(id,name) values(company_id,'Water supplier');
  insert into public.m2m_event_companies(id,event_id,company_id) values(ec,event_id,company_id),(other_ec,other_event,company_id);
  insert into public.m2m_event_holes(id,event_id,hole_number,label) values(hole,event_id,1,'Hole 1');
  insert into public.m2m_hole_sponsorship_slots(id,event_id,hole_id,label) values(hole_slot,event_id,hole,'Drinks station');
  insert into public.m2m_hole_sponsorship_slots(id,event_id,location_name,label) values(venue_slot,event_id,'Putting green','Prize display');
  booking := public.m2m_create_supplier_sponsorship(event_id,ec,'  200 bottled waters  ',venue_slot,null);
  select id into unit_id from public.m2m_sponsorship_units where commitment_id=booking;
  if not exists(select 1 from public.m2m_sponsorship_commitments where id=booking and contribution='200 bottled waters' and payment_status='waived' and confirmed_amount_minor=0) then raise exception 'Contribution not saved'; end if;
  if not exists(select 1 from public.m2m_sponsorship_units where id=unit_id and hole_slot_id=venue_slot) then raise exception 'Venue not assigned'; end if;
  -- Creating against an occupied position rolls back the entire booking.
  select count(*) into before_count from public.m2m_sponsorship_commitments;
  begin
    perform public.m2m_create_supplier_sponsorship(event_id,ec,'Prizes',venue_slot,null);
    raise exception 'Double booking accepted';
  exception when unique_violation then null; end;
  if (select count(*) from public.m2m_sponsorship_commitments) <> before_count then raise exception 'Partial booking left behind'; end if;
  -- Move between a venue and a numbered hole, releasing the previous position.
  perform public.m2m_allocate_sponsorship_unit(event_id,unit_id,hole_slot,null);
  second_booking := public.m2m_create_supplier_sponsorship(event_id,ec,'Competition prizes',venue_slot,null);
  select id into second_unit from public.m2m_sponsorship_units where commitment_id=second_booking;
  if (select count(*) from public.m2m_sponsorship_types where category='supplier') < 1 then raise exception 'Supplier package missing'; end if;
  -- Event boundaries remain enforced by existing composite foreign keys and RPC scope.
  begin
    perform public.m2m_create_supplier_sponsorship(other_event,other_ec,'Other prizes',hole_slot,null);
    raise exception 'Cross-event placement accepted';
  exception when no_data_found then null; end;
  begin
    perform public.m2m_create_supplier_sponsorship(event_id,other_ec,'Wrong company',null,null);
    raise exception 'Cross-event supplier accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.m2m_sponsorship_commitments set contribution='' where id=booking;
    raise exception 'Blank supplier contribution accepted';
  exception when check_violation then null; end;
  -- Hole packages cannot be moved to venue-only positions, even via the API.
  insert into public.m2m_sponsorship_types(id,event_id,name,capacity,requires_hole) values(hole_type,event_id,'Hole only',1,true);
  insert into public.m2m_sponsorship_commitments(id,event_id,event_company_id,sponsorship_type_id,status) values(hole_booking,event_id,ec,hole_type,'confirmed');
  update public.m2m_sponsorship_units set hole_slot_id=null where id=second_unit;
  begin
    perform public.m2m_allocate_sponsorship_unit(event_id,(select id from public.m2m_sponsorship_units where commitment_id=hole_booking),venue_slot,null);
    raise exception 'Hole package placed at venue';
  exception when check_violation then null; end;
  -- Venue names cannot silently create duplicate positions with case/space variations.
  begin
    insert into public.m2m_hole_sponsorship_slots(event_id,location_name,label) values(event_id,' putting GREEN ','Prize display');
    raise exception 'Duplicate venue position accepted';
  exception when unique_violation then null; end;
end;
$$;
rollback;
