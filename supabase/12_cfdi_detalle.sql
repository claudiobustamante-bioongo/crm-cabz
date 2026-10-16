-- =====================================================================
-- CRM CABZ · 12_cfdi_detalle.sql
-- Columnas del Panel_Facturas_Maestro que faltaban en cfdi + vista con
-- archivo de origen y total en MXN. Correr DESPUÉS de 10.
-- =====================================================================
alter table cfdi
  add column if not exists num serial,                 -- ID consecutivo
  add column if not exists vencimiento date,
  add column if not exists confianza text;             -- alta / media / baja (lectura por IA de PDF)

drop view if exists v_cfdi_mensual;
drop view if exists v_cfdi;
create view v_cfdi with (security_invoker = true) as
select c.*,
       r.nombre as rubro, rp.nombre as grupo,
       m.id as movimiento_id, m.descripcion as movimiento, m.fecha as movimiento_fecha, m.monto as movimiento_monto,
       cu.nombre as cuenta,
       dx.storage_path as xml_path, dx.nombre as xml_nombre, dp.storage_path as pdf_path, dp.nombre as pdf_nombre,
       round(c.total * coalesce(c.tc, tc_mxn(c.moneda, c.fecha), 1), 2) as total_mxn
from cfdi c
left join rubros r  on r.id = c.rubro_id
left join rubros rp on rp.id = r.padre_id
left join movimientos m on m.cfdi_uuid = c.uuid
left join cuentas cu on cu.id = m.cuenta_id
left join documentos dx on dx.id = c.xml_documento_id
left join documentos dp on dp.id = c.pdf_documento_id;

-- Resumen mensual para el panel principal
create view v_cfdi_mensual with (security_invoker = true) as
select extract(year from fecha)::int as anio, date_trunc('month', fecha)::date as mes, tipo::text as tipo,
       count(*) as facturas, sum(total_mxn) as total_mxn, sum(iva) as iva, sum(ret_isr) as ret_isr, sum(ret_iva) as ret_iva,
       count(*) filter (where estado = 'nueva') as por_ligar
from v_cfdi group by 1, 2, 3;
grant select on v_cfdi, v_cfdi_mensual to authenticated;
