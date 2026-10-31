-- 44: deudas — ajustar el saldo real a una fecha (regenera la tabla de amortización) y pagos desde Gastos.
--     v_deudas: el saldo de referencia manda si es más reciente que el último pago marcado.
create or replace view v_deudas with (security_invoker = true) as
select d.id as deuda_id, c.nombre as deuda, c.moneda, d.metodo, d.tasa_anual, d.tasa_es_implicita,
       coalesce((select saldo_final from amortizacion
                  where deuda_id = d.id and estado = 'pagado' and fecha > d.fecha_saldo_referencia order by numero desc limit 1),
                d.saldo_referencia) as saldo_actual,
       px.fecha as proximo_pago_fecha, px.pago_total as proximo_pago_monto,
       (select count(*) from amortizacion where deuda_id = d.id and estado = 'proyectado') as pagos_restantes,
       (select max(fecha) from amortizacion where deuda_id = d.id) as fecha_liquidacion,
       (select sum(interes + interes_fijo + iva + seguro) from amortizacion
         where deuda_id = d.id and estado = 'proyectado') as costo_financiero_restante,
       d.fecha_fin_contractual,
       d.cuenta_id, d.fecha_saldo_referencia, d.pago_periodico, d.capital_fijo, d.periodicidad
from deudas d
join cuentas c on c.id = d.cuenta_id
left join lateral (select fecha, pago_total from amortizacion
                    where deuda_id = d.id and estado = 'proyectado'
                    order by numero limit 1) px on true;
grant select on v_deudas to authenticated;

-- Ajusta el saldo real de un préstamo (lo que dice el banco) y recalcula los pagos pendientes desde el próximo pago.
create or replace function ajustar_deuda(p_deuda uuid, p_saldo numeric, p_fecha date, p_proximo_pago date default null, p_pago_periodico numeric default null)
returns int language plpgsql security invoker set search_path = public as $$
declare v_n int; v_prox date;
begin
  select coalesce(p_proximo_pago, (select min(fecha) from amortizacion where deuda_id = p_deuda and estado = 'proyectado' and fecha > p_fecha), (p_fecha + interval '1 month')::date) into v_prox;
  update deudas set saldo_referencia = p_saldo, fecha_saldo_referencia = p_fecha, primer_pago_pendiente = v_prox,
         numero_primer_pendiente = coalesce((select max(numero) from amortizacion where deuda_id = p_deuda and estado = 'pagado'), 0) + 1,
         pago_periodico = coalesce(p_pago_periodico, pago_periodico)
   where id = p_deuda and user_id = auth.uid();
  if not found then raise exception 'Deuda no encontrada'; end if;
  -- los pagos "pagados" posteriores al nuevo corte ya están dentro del saldo que dio el banco
  delete from amortizacion where deuda_id = p_deuda and estado = 'pagado' and fecha > p_fecha;
  select generar_amortizacion(p_deuda) into v_n;
  return v_n;
end $$;
grant execute on function ajustar_deuda(uuid, numeric, date, date, numeric) to authenticated;
