-- 22: Contabilidad mensual: si en un mes no hay CFDI (emitidas o nómina), toma lo capturado en Ingresos
--     (honorarios brutos, sueldo neto). Requiere 21.
drop view if exists v_contab_mensual;
create view v_contab_mensual with (security_invoker = true) as
with c as (
  select extract(year from fecha)::int as anio, extract(month from fecha)::int as mes,
       sum(case when tipo = 'emitida' and tipo_comprobante = 'I' then subtotal when tipo = 'emitida' and tipo_comprobante = 'E' then -subtotal else 0 end) as emitidas_subtotal,
       sum(case when tipo = 'emitida' and tipo_comprobante = 'I' then iva when tipo = 'emitida' and tipo_comprobante = 'E' then -iva else 0 end) as emitidas_iva,
       sum(case when tipo = 'emitida' and tipo_comprobante in ('I','E') then ret_isr * (case when tipo_comprobante = 'E' then -1 else 1 end) else 0 end) as emitidas_ret_isr,
       sum(case when tipo = 'emitida' and tipo_comprobante in ('I','E') then ret_iva * (case when tipo_comprobante = 'E' then -1 else 1 end) else 0 end) as emitidas_ret_iva,
       count(*) filter (where tipo = 'emitida' and tipo_comprobante = 'I') as emitidas_n,
       sum(case when tipo = 'recibida' and tipo_comprobante = 'I' then total_mxn when tipo = 'recibida' and tipo_comprobante = 'E' then -total_mxn else 0 end) as recibidas_total,
       sum(case when tipo = 'recibida' and tipo_comprobante = 'I' then iva when tipo = 'recibida' and tipo_comprobante = 'E' then -iva else 0 end) as recibidas_iva,
       sum(case when tipo = 'recibida' and tipo_comprobante = 'I' and coalesce(uso_cfdi,'') not like 'D%' and coalesce(uso_cfdi,'') <> 'S01' then iva
                when tipo = 'recibida' and tipo_comprobante = 'E' and coalesce(uso_cfdi,'') not like 'D%' then -iva else 0 end) as recibidas_iva_acreditable,
       count(*) filter (where tipo = 'recibida' and tipo_comprobante = 'I') as recibidas_n,
       sum(case when tipo = 'nomina' then total else 0 end) as nomina_neto,
       sum(case when tipo = 'nomina' then coalesce((conceptos->0->>'importe')::numeric, total) else 0 end) as nomina_bruto,
       sum(case when tipo = 'nomina' then ret_isr else 0 end) as nomina_isr,
       count(*) filter (where tipo = 'nomina') as nomina_n
  from v_cfdi group by 1, 2),
l as (   -- capturado en Ingresos (reales, no proyectados)
  select extract(year from fecha)::int as anio, extract(month from fecha)::int as mes,
       sum(case when tipo in ('comision') then coalesce(bruto, monto) else 0 end) as hon_bruto,
       sum(case when tipo in ('comision') then iva else 0 end) as hon_iva,
       sum(case when tipo in ('comision') then ret_isr else 0 end) as hon_ret_isr,
       sum(case when tipo in ('comision') then ret_iva else 0 end) as hon_ret_iva,
       count(*) filter (where tipo = 'comision') as hon_n,
       sum(case when tipo in ('sueldo','bono') then monto_mxn else 0 end) as sueldo_neto,
       sum(case when tipo in ('sueldo','bono') then coalesce(bruto, 0) else 0 end) as sueldo_bruto,
       sum(case when tipo in ('sueldo','bono') then ret_isr else 0 end) as sueldo_isr,
       count(*) filter (where tipo in ('sueldo','bono')) as sueldo_n
  from v_ingresos where estado = 'real' and not proyectado group by 1, 2),
k as (select anio, mes from c union select anio, mes from l)
select k.anio, k.mes,
       case when coalesce(c.emitidas_n,0) > 0 then c.emitidas_subtotal else coalesce(l.hon_bruto,0) end as emitidas_subtotal,
       case when coalesce(c.emitidas_n,0) > 0 then c.emitidas_iva      else coalesce(l.hon_iva,0) end as emitidas_iva,
       case when coalesce(c.emitidas_n,0) > 0 then c.emitidas_ret_isr  else coalesce(l.hon_ret_isr,0) end as emitidas_ret_isr,
       case when coalesce(c.emitidas_n,0) > 0 then c.emitidas_ret_iva  else coalesce(l.hon_ret_iva,0) end as emitidas_ret_iva,
       case when coalesce(c.emitidas_n,0) > 0 then c.emitidas_n else coalesce(l.hon_n,0) end as emitidas_n,
       (coalesce(c.emitidas_n,0) = 0 and coalesce(l.hon_n,0) > 0) as emitidas_de_ingresos,
       coalesce(c.recibidas_total,0) as recibidas_total, coalesce(c.recibidas_iva,0) as recibidas_iva,
       coalesce(c.recibidas_iva_acreditable,0) as recibidas_iva_acreditable, coalesce(c.recibidas_n,0) as recibidas_n,
       case when coalesce(c.nomina_n,0) > 0 then c.nomina_neto  else coalesce(l.sueldo_neto,0) end as nomina_neto,
       case when coalesce(c.nomina_n,0) > 0 then c.nomina_bruto else coalesce(nullif(l.sueldo_bruto,0), l.sueldo_neto, 0) end as nomina_bruto,
       case when coalesce(c.nomina_n,0) > 0 then c.nomina_isr   else coalesce(l.sueldo_isr,0) end as nomina_isr,
       case when coalesce(c.nomina_n,0) > 0 then c.nomina_n else coalesce(l.sueldo_n,0) end as nomina_n,
       (coalesce(c.nomina_n,0) = 0 and coalesce(l.sueldo_n,0) > 0) as nomina_de_ingresos
from k left join c on c.anio = k.anio and c.mes = k.mes left join l on l.anio = k.anio and l.mes = k.mes;
grant select on v_contab_mensual to authenticated;
select anio, mes, emitidas_subtotal, emitidas_de_ingresos, nomina_neto, nomina_bruto, nomina_de_ingresos from v_contab_mensual where anio = 2026 order by mes;
