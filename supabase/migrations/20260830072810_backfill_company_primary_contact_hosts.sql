update public.m2m_event_companies as event_company
set primary_contact_profile_id = profile.id
from public.m2m_profiles as profile
where event_company.primary_contact_profile_id is null
  and event_company.primary_contact_email is not null
  and lower(btrim(event_company.primary_contact_email)) = lower(btrim(profile.email));

update public.m2m_fourball_hosts as host_assignment
set is_primary = true
from public.m2m_fourballs as fourball
join public.m2m_event_companies as event_company
  on event_company.id = fourball.event_company_id
where host_assignment.fourball_id = fourball.id
  and host_assignment.profile_id = event_company.primary_contact_profile_id
  and event_company.primary_contact_profile_id is not null
  and not exists (
    select 1 from public.m2m_fourball_hosts as current_primary
    where current_primary.fourball_id = fourball.id
      and current_primary.is_primary
  );

insert into public.m2m_fourball_hosts (
  event_id, fourball_id, profile_id, is_primary
)
select fourball.event_id, fourball.id, event_company.primary_contact_profile_id, true
from public.m2m_fourballs as fourball
join public.m2m_event_companies as event_company
  on event_company.id = fourball.event_company_id
where event_company.primary_contact_profile_id is not null
  and fourball.booking_status <> 'cancelled'
  and not exists (
    select 1 from public.m2m_fourball_hosts as current_primary
    where current_primary.fourball_id = fourball.id
      and current_primary.is_primary
  )
  and not exists (
    select 1 from public.m2m_fourball_hosts as same_contact
    where same_contact.fourball_id = fourball.id
      and same_contact.profile_id = event_company.primary_contact_profile_id
  );
