create index if not exists fourball_players_updated_by_idx
  on public.fourball_players (updated_by)
  where updated_by is not null;

create index if not exists host_import_batches_uploaded_by_admin_idx
  on public.host_import_batches (uploaded_by_admin_id)
  where uploaded_by_admin_id is not null;

create index if not exists host_import_rows_applied_company_idx
  on public.host_import_rows (applied_company_id)
  where applied_company_id is not null;

create index if not exists admin_audit_log_administrator_idx
  on public.admin_audit_log (administrator_id)
  where administrator_id is not null;
