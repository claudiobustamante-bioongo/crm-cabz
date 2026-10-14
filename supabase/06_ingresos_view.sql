-- =====================================================================
-- CRM CABZ · 06_ingresos_view.sql
-- Vista de ingresos para la app (movimiento + desglose fiscal + quién aporta).
-- Correr DESPUÉS de 05.
-- =====================================================================
create or replace view v_ingresos with (security_invoker = true) as
select m.id, m.fecha, m.mes, m.estado, m.descripcion, m.monto, m.monto_mxn, m.moneda,
       m.cuenta, m.cuenta_destino, m.tiene_cfdi, m.cfdi_uuid, m.notas,
       d.tipo, d.bruto, d.iva, d.ret_isr, d.ret_iva, d.cliente, d.proyectado,
       p.codigo as aporta, p.nombre as aporta_nombre
from ingresos_detalle d
join v_movimientos m on m.id = d.movimiento_id
left join pagadores p on p.id = d.aporta_id;
