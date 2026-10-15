-- =====================================================================
-- CRM CABZ · 09_saldos_sin_futuro.sql
-- Los cargos con fecha futura (p. ej. meses sin intereses ya registrados)
-- no deben inflar el saldo de HOY de tarjetas y cheques.
-- =====================================================================
create or replace view v_saldo_cuentas with (security_invoker = true) as
with mov as (
  select m.cuenta_id as cuenta_id, m.fecha,
         case when m.tipo in ('ingreso','reembolso') then 1 else -1 end *
         case when m.moneda = c.moneda then m.monto
              when m.monto_cuenta is not null then m.monto_cuenta
              else round(m.monto * tc_mxn(m.moneda, m.fecha) / tc_mxn(c.moneda, m.fecha), 2) end as importe
  from movimientos m join cuentas c on c.id = m.cuenta_id
  where m.estado = 'real' and m.fecha <= current_date
  union all
  select m.cuenta_destino_id, m.fecha,
         case when m.moneda = c.moneda then m.monto
              else round(m.monto * tc_mxn(m.moneda, m.fecha) / tc_mxn(c.moneda, m.fecha), 2) end
  from movimientos m join cuentas c on c.id = m.cuenta_destino_id
  where m.estado = 'real' and m.cuenta_destino_id is not null and m.fecha <= current_date)
select c.id, c.nombre, c.tipo, c.moneda,
       c.saldo_inicial + coalesce(sum(mov.importe) filter (where c.fecha_saldo_inicial is null or mov.fecha > c.fecha_saldo_inicial), 0) as saldo,
       round((c.saldo_inicial + coalesce(sum(mov.importe) filter (where c.fecha_saldo_inicial is null or mov.fecha > c.fecha_saldo_inicial), 0))
             * tc_mxn(c.moneda, current_date), 2) as saldo_mxn
from cuentas c left join mov on mov.cuenta_id = c.id
where c.tipo <> 'prestamo' and c.activa
group by c.id;

-- Compromisos futuros ya registrados (MSI, cargos programados): lo que viene por tarjeta
create or replace view v_compromisos_futuros with (security_invoker = true) as
select c.nombre as cuenta, date_trunc('month', m.fecha)::date as mes, sum(m.monto) as monto, count(*) as cargos
from movimientos m join cuentas c on c.id = m.cuenta_id
where m.estado = 'real' and m.tipo = 'gasto' and m.fecha > current_date
group by 1, 2 order by 2, 1;
