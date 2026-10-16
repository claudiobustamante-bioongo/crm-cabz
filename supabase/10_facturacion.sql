-- =====================================================================
-- CRM CABZ · 10_facturacion.sql
-- Facturación: CFDI subidos desde la app (XML + PDF en Storage), liga con
-- movimientos, rubro sugerido, y deducciones personales (art. 151 LISR).
-- Correr DESPUÉS de 09. Sin datos personales (el RFC va en 11).
-- =====================================================================

-- 1. Tipo de comprobante nómina (se usa desde la app; aquí solo se declara)
alter type tipo_cfdi add value if not exists 'nomina';

-- 2. Columnas nuevas en cfdi
alter table cfdi
  add column if not exists tipo_comprobante char(1),           -- I ingreso · E egreso · N nómina · P pago
  add column if not exists rubro_id uuid references rubros(id),
  add column if not exists estado text not null default 'nueva'
      check (estado in ('nueva','ligada','revisar','sin_gasto')),
  add column if not exists conceptos jsonb,
  add column if not exists importacion_id uuid references importaciones(id);

-- 3. Deducibilidad por subrubro (art. 151 LISR)
alter table rubros add column if not exists deduccion text
  check (deduccion in ('gmm','medico','ppr','funeral','colegiatura','hipoteca','donativo'));
update rubros r set deduccion = x.d from (values
  ('SEGUROS__GMM','gmm'), ('SEGUROS__SEGURO_GMM','gmm'), ('AKELA__SEGURO_GMM','gmm'), ('AKELA__SEGURO_GMM_PAPAS','gmm'),
  ('SALUD__DOCTORES','medico'), ('SALUD__DENTISTA','medico'), ('SALUD__PEDIATRA','medico'), ('SALUD__MEDICO','medico'),
  ('SALUD__DERMATOLOGO','medico'), ('SALUD__DOCTORES_DERMATOLO_Y_FISIO','medico'), ('SALUD__ORTOPEDISTA_SOFIA','medico'),
  ('SALUD__ESTUDIOS','medico'),
  ('AHORRO__PPR','ppr'), ('AHORRO__AFORE_VOLUNTARIA','ppr')
) as x(codigo, d) where r.codigo = x.codigo and r.user_id = crm_owner();

-- 4. RFC propio para clasificar emitida / recibida al subir XML
alter table app_config add column if not exists rfc_propio text;

-- 5. Vista de CFDI con su movimiento ligado y rubro
create or replace view v_cfdi with (security_invoker = true) as
select c.*,
       r.nombre as rubro, rp.nombre as grupo,
       m.id as movimiento_id, m.descripcion as movimiento, m.fecha as movimiento_fecha, m.monto as movimiento_monto,
       cu.nombre as cuenta,
       dx.storage_path as xml_path, dp.storage_path as pdf_path
from cfdi c
left join rubros r  on r.id = c.rubro_id
left join rubros rp on rp.id = r.padre_id
left join movimientos m on m.cfdi_uuid = c.uuid
left join cuentas cu on cu.id = m.cuenta_id
left join documentos dx on dx.id = c.xml_documento_id
left join documentos dp on dp.id = c.pdf_documento_id;

-- 6. Deducciones personales: cada gasto con rubro deducible y si cumple requisitos
--    (CFDI ligado + pago sin efectivo: aquí todas las cuentas son bancarizadas)
create or replace view v_deducciones with (security_invoker = true) as
select extract(year from m.fecha)::int as anio, m.fecha, m.id as movimiento_id, m.descripcion,
       coalesce(r.deduccion, rp.deduccion) as categoria, rp.nombre as grupo, r.nombre as rubro,
       round(m.monto * tc_mxn(m.moneda, m.fecha), 2) as monto_mxn,
       m.tiene_cfdi, m.cfdi_uuid, cu.nombre as cuenta, cu.tipo as cuenta_tipo,
       (m.tiene_cfdi or coalesce(r.deduccion, rp.deduccion) = 'ppr') as cumple   -- PPR se acredita con constancia, no CFDI
from movimientos m
join rubros r on r.id = m.rubro_id
left join rubros rp on rp.id = r.padre_id
join cuentas cu on cu.id = m.cuenta_id
where m.estado = 'real' and m.tipo in ('gasto','ahorro') and coalesce(r.deduccion, rp.deduccion) is not null;

-- 7. Resumen anual de deducciones por categoría
create or replace view v_deducciones_anual with (security_invoker = true) as
select anio, categoria,
       sum(monto_mxn) as registrado,
       sum(monto_mxn) filter (where cumple) as con_comprobante,
       count(*) as movimientos,
       count(*) filter (where not cumple) as sin_cfdi
from v_deducciones group by anio, categoria;

grant select on v_cfdi, v_deducciones, v_deducciones_anual to authenticated;
