-- STAGING ONLY. Synthetic records for Huve and Jaryd acceptance testing.
-- Do not run this file against production.

do $$
declare
  event_id_value uuid;
  fourball_package_id uuid;
  sponsor_without_id uuid;
  sponsor_with_id uuid;
  company_id_value uuid;
  booking_id_value uuid;
  allocation_id_value uuid;
  company_record record;
  allocation_index integer;
begin
  select id into event_id_value
  from public.golf_events
  where event_code = 'm2m-invitational-2026';

  select id into fourball_package_id
  from public.package_catalog
  where event_id = event_id_value and code = 'fourball';
  select id into sponsor_without_id
  from public.package_catalog
  where event_id = event_id_value and code = 'hole-without-alcohol';
  select id into sponsor_with_id
  from public.package_catalog
  where event_id = event_id_value and code = 'hole-with-alcohol';

  for company_record in
    select * from (values
      ('STAGE-HUVE', 'M2M Staging · Hole 2 Host', 'Huve', 'Tester', 'huve@marketing2themax.co.za', '082 000 0001', 1, 'hole-without-alcohol', 2),
      ('STAGE-JARYD', 'M2M Staging · Multi Fourball Host', 'Jaryd', 'Tester', 'jaryd@marketing2themax.co.za', '082 000 0002', 2, 'hole-without-alcohol', null),
      ('STAGE-FOURBALL', 'Fictional Fairway Holdings', 'Ava', 'Example', 'ava@example.invalid', '082 000 0003', 1, 'none', null),
      ('STAGE-SPONSOR', 'Fictional Tee Box Brands', 'Noah', 'Example', 'noah@example.invalid', '082 000 0004', 0, 'hole-with-alcohol', null)
    ) as seed(
      company_reference, company_name, contact_first_name, contact_surname,
      contact_email, mobile, fourball_quantity, sponsorship_type, hole_number
    )
  loop
    insert into public.host_companies (
      company_reference, company_name, contact_first_name, contact_surname,
      contact_email, mobile, internal_notes
    ) values (
      company_record.company_reference, company_record.company_name,
      company_record.contact_first_name, company_record.contact_surname,
      company_record.contact_email, company_record.mobile,
      'Synthetic staging acceptance-test record. No client data.'
    )
    on conflict ((lower(company_reference))) where company_reference is not null
    do update set
      company_name = excluded.company_name,
      contact_first_name = excluded.contact_first_name,
      contact_surname = excluded.contact_surname,
      contact_email = excluded.contact_email,
      mobile = excluded.mobile,
      internal_notes = excluded.internal_notes,
      is_active = true
    returning id into company_id_value;

    insert into public.host_accounts (company_id, login_email, account_status)
    values (company_id_value, company_record.contact_email, 'pending_review')
    on conflict (company_id) do update set
      login_email = excluded.login_email,
      account_status = case
        when public.host_accounts.account_status in ('invited', 'active') then public.host_accounts.account_status
        else 'pending_review'
      end;

    insert into public.host_bookings (
      company_id, event_id, booking_reference, status, internal_notes
    ) values (
      company_id_value,
      event_id_value,
      'BOOK-' || company_record.company_reference,
      'confirmed',
      'Synthetic staging allocation.'
    )
    on conflict (company_id, event_id) do update set
      booking_reference = excluded.booking_reference,
      status = 'confirmed',
      internal_notes = excluded.internal_notes
    returning id into booking_id_value;

    delete from public.booking_allocations where booking_id = booking_id_value;

    for allocation_index in 1..company_record.fourball_quantity loop
      insert into public.booking_allocations (
        booking_id, event_id, package_id, allocation_type, allocation_number, price_zar
      ) values (
        booking_id_value, event_id_value, fourball_package_id,
        'fourball', allocation_index, 15000
      ) returning id into allocation_id_value;
      insert into public.fourball_players (allocation_id, slot_number)
      select allocation_id_value, slot from generate_series(1, 4) slot;
    end loop;

    if company_record.sponsorship_type <> 'none' then
      insert into public.booking_allocations (
        booking_id, event_id, package_id, allocation_type, allocation_number,
        hole_number, price_zar
      ) values (
        booking_id_value,
        event_id_value,
        case when company_record.sponsorship_type = 'hole-with-alcohol' then sponsor_with_id else sponsor_without_id end,
        'hole_sponsorship',
        1,
        company_record.hole_number,
        case when company_record.sponsorship_type = 'hole-with-alcohol' then 17000 else 12500 end
      );
    end if;
  end loop;
end;
$$;

