update public.m2m_profiles as profile
set role = legacy_admin.role,
    is_active = true,
    updated_at = now()
from public.m2m_admin_users as legacy_admin
where lower(btrim(profile.email)) = lower(btrim(legacy_admin.email))
  and legacy_admin.is_active
  and legacy_admin.role in ('admin', 'super_admin')
  and profile.role = 'host';
