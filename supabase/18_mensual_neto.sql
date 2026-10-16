-- 18: el resumen mensual neta notas de crédito (E restan) y no suma complementos de pago (P) ni traslados (T).
--     Las cuenta aparte para que se vean. Requiere 12.
drop view if exists v_cfdi_mensual;
create view v_cfdi_mensual with (security_invoker = true) as
select extract(year from fecha)::int as anio, date_trunc('month', fecha)::date as mes, tipo::text as tipo,
       count(*) filter (where coalesce(tipo_comprobante, 'I') in ('I', 'N')) as facturas,
       sum(case when tipo_comprobante = 'E' then -total_mxn when tipo_comprobante in ('P', 'T') then 0 else total_mxn end) as total_mxn,
       sum(case when tipo_comprobante = 'E' then -iva when tipo_comprobante in ('P', 'T') then 0 else iva end) as iva,
       sum(ret_isr) as ret_isr, sum(ret_iva) as ret_iva,
       count(*) filter (where estado = 'nueva') as por_ligar,
       count(*) filter (where tipo_comprobante = 'E') as notas_credito,
       count(*) filter (where tipo_comprobante = 'P') as pagos
from v_cfdi group by 1, 2, 3;
grant select on v_cfdi_mensual to authenticated;
select mes, tipo, facturas, total_mxn, iva, notas_credito, pagos from v_cfdi_mensual where tipo = 'recibida' order by mes;
