-- 26: RLS en anios (catálogo sin user_id): lectura para cualquier sesión, escritura solo del dueño.
alter table anios enable row level security;
drop policy if exists anios_read on anios;
create policy anios_read on anios for select to authenticated using (true);
drop policy if exists anios_write on anios;
create policy anios_write on anios for all to authenticated
  using (auth.uid() = (select owner_id from app_config limit 1))
  with check (auth.uid() = (select owner_id from app_config limit 1));
-- por si el lint marca más tablas sin RLS:
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
