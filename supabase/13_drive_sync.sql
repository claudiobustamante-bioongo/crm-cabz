-- =====================================================================
-- CRM CABZ · 13_drive_sync.sql
-- Sincronización con Google Drive: registro de archivos procesados,
-- reglas RFC→rubro que aprenden solas, facturas extranjeras y
-- deducciones calculadas por rubro de la factura (sin ligar gastos).
-- Correr DESPUÉS de 12.
-- =====================================================================

-- 1. Archivos de Drive ya procesados (idempotencia)
create table if not exists drive_sync (
  drive_id     text primary key,
  user_id      uuid not null default crm_owner() references auth.users(id) on delete cascade,
  nombre       text not null,
  mime         text,
  carpeta      text,                       -- ruta dentro de "01 - Facturas"
  tipo         text not null check (tipo in ('cfdi','pdf_cfdi','extranjera','omitido','error')),
  mes          date,                       -- mes catalogado (día 1)
  cfdi_uuid    uuid references cfdi(uuid) on delete set null,
  documento_id uuid references documentos(id) on delete set null,
  link_drive   text,
  detalle      text,
  procesado_en timestamptz not null default now()
);
alter table drive_sync enable row level security;
drop policy if exists owner_all on drive_sync;
create policy owner_all on drive_sync for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Reglas: el rubro que eliges para un emisor se recuerda y se aplica a sus siguientes facturas
create table if not exists cfdi_reglas (
  user_id     uuid not null default crm_owner() references auth.users(id) on delete cascade,
  emisor_rfc  text not null,
  rubro_id    uuid not null references rubros(id),
  veces       int not null default 1,
  actualizado timestamptz not null default now(),
  primary key (user_id, emisor_rfc)
);
alter table cfdi_reglas enable row level security;
drop policy if exists owner_all on cfdi_reglas;
create policy owner_all on cfdi_reglas for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- al fijar rubro en una factura: aprende la regla y aplica a las demás del mismo emisor sin rubro
create or replace function trg_cfdi_regla() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rubro_id is not null and new.tipo = 'recibida' and (old.rubro_id is distinct from new.rubro_id) then
    insert into cfdi_reglas (user_id, emisor_rfc, rubro_id) values (new.user_id, new.emisor_rfc, new.rubro_id)
    on conflict (user_id, emisor_rfc) do update set rubro_id = excluded.rubro_id, veces = cfdi_reglas.veces + 1, actualizado = now();
    update cfdi set rubro_id = new.rubro_id where user_id = new.user_id and emisor_rfc = new.emisor_rfc and rubro_id is null and tipo = 'recibida';
  end if;
  return new;
end $$;
drop trigger if exists t_cfdi_regla on cfdi;
create trigger t_cfdi_regla after update of rubro_id on cfdi for each row execute function trg_cfdi_regla();

-- al insertar una factura: aplica la regla si existe
create or replace function trg_cfdi_regla_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rubro_id is null and new.tipo = 'recibida' then
    select rubro_id into new.rubro_id from cfdi_reglas where user_id = new.user_id and emisor_rfc = new.emisor_rfc;
  end if;
  return new;
end $$;
drop trigger if exists t_cfdi_regla_ins on cfdi;
create trigger t_cfdi_regla_ins before insert on cfdi for each row execute function trg_cfdi_regla_ins();

-- 3. Deducciones: registrado = gastos por rubro deducible; con CFDI = facturas recibidas a tu nombre con rubro deducible
drop view if exists v_deducciones_anual;
create view v_deducciones_anual with (security_invoker = true) as
with g as (
  select anio, categoria, sum(monto_mxn) as registrado, count(*) as movimientos
  from v_deducciones group by 1, 2),
f as (
  select extract(year from c.fecha)::int as anio, coalesce(r.deduccion, rp.deduccion) as categoria,
         sum(c.total_mxn) as con_comprobante, count(*) as facturas
  from v_cfdi c join rubros r on r.id = c.rubro_id left join rubros rp on rp.id = r.padre_id
  where c.tipo = 'recibida' and coalesce(r.deduccion, rp.deduccion) is not null
    and (c.receptor_rfc = (select rfc_propio from app_config) or (select rfc_propio from app_config) is null)
  group by 1, 2)
select coalesce(g.anio, f.anio) as anio, coalesce(g.categoria, f.categoria) as categoria,
       coalesce(g.registrado, 0) as registrado, coalesce(f.con_comprobante, 0) as con_comprobante,
       coalesce(g.movimientos, 0) as movimientos, coalesce(f.facturas, 0) as facturas
from g full join f on f.anio = g.anio and f.categoria = g.categoria;
grant select on v_deducciones_anual to authenticated;

-- 4. Vista de extranjeras (PDF sin CFDI) por mes
drop view if exists v_facturas_ext;
create view v_facturas_ext with (security_invoker = true) as
select s.drive_id, s.nombre, s.carpeta, s.mes, s.link_drive, s.procesado_en, d.storage_path
from drive_sync s left join documentos d on d.id = s.documento_id
where s.tipo = 'extranjera';
grant select on v_facturas_ext to authenticated;
