-- generado desde supabase/45_extranjeras_ligar.sql (no editar aquí; edita el original y corre node scripts/migraciones.mjs)
-- 45: facturas extranjeras (PDF sin CFDI) ligables a un gasto. documentos.movimiento_id + vista con el gasto.
alter table documentos add column if not exists movimiento_id uuid references movimientos(id) on delete set null;
create index if not exists documentos_mov_idx on documentos(movimiento_id);
drop view if exists v_facturas_ext;
create view v_facturas_ext with (security_invoker = true) as
select s.drive_id, s.nombre, s.carpeta, s.mes, s.link_drive, s.procesado_en, d.storage_path,
       d.id as documento_id, d.movimiento_id, d.notas,
       m.fecha as gasto_fecha, m.monto_mxn as gasto_monto, m.rubro as gasto_rubro, m.cuenta as gasto_cuenta, m.descripcion as gasto_descripcion
from drive_sync s
left join documentos d on d.id = s.documento_id
left join v_movimientos m on m.id = d.movimiento_id
where s.tipo = 'extranjera';
grant select on v_facturas_ext to authenticated;
-- cuántos comprobantes (extranjeros) tiene cada gasto, para Gastos
create or replace view v_docs_por_mov with (security_invoker = true) as
select movimiento_id, count(*) as docs from documentos where movimiento_id is not null group by 1;
grant select on v_docs_por_mov to authenticated;
