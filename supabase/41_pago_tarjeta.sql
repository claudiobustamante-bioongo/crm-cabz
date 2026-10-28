-- 41: pagos de tarjeta = transferencia (cheques → tarjeta), no gasto. Corrige el doble conteo:
--     los gastos ya van cargados a la tarjeta; el pago solo mueve dinero de Cheques a la tarjeta.
--     1) convierte los gastos con rubro «Pago de tarjeta» (grupo Deuda) en transferencias a la tarjeta que diga la descripción;
--     2) desactiva ese rubro para que no se vuelva a usar.
with pagos as (
  select m.id, m.descripcion, m.notas,
         (select id from cuentas c where c.user_id = crm_owner() and c.tipo = 'tarjeta_credito' and c.activa
            and (c.nombre ilike '%amex%') limit 1) as amex,
         (select id from cuentas c where c.user_id = crm_owner() and c.tipo = 'tarjeta_credito' and c.activa
            and (c.nombre ilike '%santander%') limit 1) as santander,
         (select count(*) from cuentas c where c.user_id = crm_owner() and c.tipo = 'tarjeta_credito' and c.activa) as n_tarjetas,
         (select id from cuentas c where c.user_id = crm_owner() and c.tipo = 'tarjeta_credito' and c.activa limit 1) as unica
  from movimientos m join rubros r on r.id = m.rubro_id
  where m.user_id = crm_owner() and m.tipo = 'gasto' and r.nombre ilike 'pago de tarjeta%'
),
destino as (
  select id, case when coalesce(descripcion, '') || ' ' || coalesce(notas, '') ilike '%amex%' then amex
                  when coalesce(descripcion, '') || ' ' || coalesce(notas, '') ilike '%santander%' then santander
                  when n_tarjetas = 1 then unica
                  else amex end as tarjeta_id
  from pagos
)
update movimientos m set tipo = 'transferencia', cuenta_destino_id = d.tarjeta_id, rubro_id = null,
  notas = concat_ws(' · ', m.notas, 'antes: gasto «Pago de tarjeta» (41)')
from destino d where m.id = d.id and d.tarjeta_id is not null;
-- las transferencias no llevan reparto
delete from asignaciones a using movimientos m where a.movimiento_id = m.id and m.user_id = crm_owner() and m.tipo = 'transferencia' and m.notas like '%(41)%';
update rubros set activo = false where user_id = crm_owner() and nombre ilike 'pago de tarjeta%';
select to_char(m.fecha, 'YYYY-MM') as mes, c.nombre as tarjeta, count(*) as pagos, sum(m.monto) as monto
from movimientos m join cuentas c on c.id = m.cuenta_destino_id
where m.user_id = crm_owner() and m.notas like '%(41)%' group by 1, 2 order by 1, 2;
select nombre, saldo from v_saldo_cuentas where tipo in ('tarjeta_credito', 'cheques') order by tipo, nombre;
