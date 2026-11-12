-- generado desde supabase/47_metas_ahorro.sql (no editar aquí; edita el original y corre node scripts/migraciones.mjs)
-- 47: metas de ahorro (Analíticas): cuánto quiero mandar a cada cuenta por mes o por año.
--     El real se mide con los movimientos tipo 'ahorro' cuyo destino es la cuenta de la meta.
create table if not exists metas_ahorro (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default crm_owner() references auth.users(id) on delete cascade,
  nombre    text not null,
  monto     numeric(14,2) not null check (monto > 0),
  periodo   text not null default 'mes' check (periodo in ('mes','anio')),
  cuenta_id uuid references cuentas(id) on delete set null,
  activa    boolean not null default true,
  orden     int not null default 0,
  creado_en timestamptz not null default now()
);
alter table metas_ahorro enable row level security;
drop policy if exists owner_all on metas_ahorro;
create policy owner_all on metas_ahorro for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Ejemplo (ajusta nombres de cuenta):
-- insert into metas_ahorro (nombre, monto, periodo, cuenta_id) select 'Bioongo', 50000, 'mes', id from cuentas where nombre ilike '%bioongo%' limit 1;
-- insert into metas_ahorro (nombre, monto, periodo, cuenta_id) select 'PPR', 220000, 'anio', id from cuentas where nombre ilike '%ppr%' limit 1;
