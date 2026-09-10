begin;
set local role service_role;
do $$
declare e uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); ec uuid:=gen_random_uuid(); b uuid;
begin
  insert into public.m2m_events(id,name,slug) values(e,'Prize test','prize-'||e);
  insert into public.m2m_companies(id,name) values(c,'Synthetic prize supplier');
  insert into public.m2m_event_companies(id,event_id,company_id) values(ec,e,c);
  b:=public.m2m_create_valued_supplier_sponsorship(e,ec,'Two fourballs with carts',500050,null,null);
  if not exists(select 1 from public.m2m_sponsorship_commitments where id=b and prize_value_minor=500050 and confirmed_amount_minor=0 and payment_status='waived') then raise exception 'Prize value must save without changing cash payment'; end if;
  update public.m2m_sponsorship_commitments set prize_value_minor=750075 where id=b;
  if (select prize_value_minor from public.m2m_sponsorship_commitments where id=b) <> 750075 then raise exception 'Prize edit failed'; end if;
  begin
    perform public.m2m_create_valued_supplier_sponsorship(e,ec,'Invalid value',-1,null,null);
    raise exception 'Negative value accepted';
  exception when check_violation then null; end;
  if (select count(*) from public.m2m_sponsorship_commitments where event_id=e)<>1 then raise exception 'Failed creation left a partial record'; end if;
  b:=public.m2m_create_supplier_sponsorship(e,ec,'Old client without a value',null,null);
  if (select prize_value_minor from public.m2m_sponsorship_commitments where id=b) is not null then raise exception 'Unknown value must remain unknown'; end if;
end;
$$;
rollback;
