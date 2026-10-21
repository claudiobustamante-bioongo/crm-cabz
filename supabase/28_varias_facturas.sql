-- 28: un gasto puede tener varias facturas. cfdi.movimiento_id apunta al gasto (movimientos.cfdi_uuid se conserva
--     para la primera, por compatibilidad). Recrea v_cfdi y las vistas que dependen de ella. Requiere 25.
alter table cfdi add column if not exists movimiento_id uuid references movimientos(id) on delete set null;
create index if not exists cfdi_movimiento_idx on cfdi(movimiento_id);
update cfdi c set movimiento_id = m.id from movimientos m where m.cfdi_uuid = c.uuid and c.movimiento_id is null;

drop view if exists v_contab_mensual;
drop view if exists v_deducciones_anual;
drop view if exists v_cfdi_mensual;
drop view if exists v_cfdi;
create view v_cfdi with (security_invoker = true) as
select c.*,
       r.nombre as rubro, rp.nombre as grupo,
       m.descripcion as movimiento, m.fecha as movimiento_fecha, m.monto as movimiento_monto,
       cu.nombre as cuenta,
       dx.storage_path as xml_path, dx.nombre as xml_nombre, dp.storage_path as pdf_path, dp.nombre as pdf_nombre,
       round(c.total * coalesce(c.tc, tc_mxn(c.moneda, c.fecha), 1), 2) as total_mxn
from cfdi c
left join rubros r  on r.id = c.rubro_id
left join rubros rp on rp.id = r.padre_id
left join movimientos m on m.id = coalesce(c.movimiento_id, (select x.id from movimientos x where x.cfdi_uuid = c.uuid limit 1))
left join cuentas cu on cu.id = m.cuenta_id
left join documentos dx on dx.id = c.xml_documento_id
left join documentos dp on dp.id = c.pdf_documento_id;
grant select on v_cfdi to authenticated;

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

create view v_deducciones_anual with (security_invoker = true) as
with g as (
  select anio, categoria, sum(monto_mxn) as registrado, count(*) as movimientos
  from v_deducciones group by 1, 2),
f as (
  select extract(year from c.fecha)::int as anio, coalesce(r.deduccion, rp.deduccion) as categoria,
         sum(case when c.tipo_comprobante = 'E' then -c.total_mxn else c.total_mxn end) as con_comprobante,
         count(*) filter (where coalesce(c.tipo_comprobante, 'I') = 'I') as facturas
  from v_cfdi c join rubros r on r.id = c.rubro_id left join rubros rp on rp.id = r.padre_id
  where c.tipo = 'recibida' and coalesce(c.tipo_comprobante, 'I') in ('I', 'E')
    and coalesce(r.deduccion, rp.deduccion) is not null
    and (c.receptor_rfc = (select rfc_propio from app_config) or (select rfc_propio from app_config) is null)
  group by 1, 2)
select coalesce(g.anio, f.anio) as anio, coalesce(g.categoria, f.categoria) as categoria,
       coalesce(g.registrado, 0) as registrado, coalesce(f.con_comprobante, 0) as con_comprobante,
       coalesce(g.movimientos, 0) as movimientos, coalesce(f.facturas, 0) as facturas
from g full join f on f.anio = g.anio and f.categoria = g.categoria;
grant select on v_deducciones_anual to authenticated;

create or replace view v_contab_mensual with (security_invoker = true) as
with c as (
  select extract(year from fecha)::int as anio, extract(month from fecha)::int as mes,
       sum(case when tipo = 'emitida' and tipo_comprobante = 'I' then subtotal when tipo = 'emitida' and tipo_comprobante = 'E' then -subtotal else 0 end) as emitidas_subtotal,
       sum(case when tipo = 'emitida' and tipo_comprobante = 'I' then iva when tipo = 'emitida' and tipo_comprobante = 'E' then -iva else 0 end) as emitidas_iva,
       sum(case when tipo = 'emitida' and tipo_comprobante in ('I','E') then ret_isr * (case when tipo_comprobante = 'E' then -1 else 1 end) else 0 end) as emitidas_ret_isr,
       sum(case when tipo = 'emitida' and tipo_comprobante in ('I','E') then ret_iva * (case when tipo_comprobante = 'E' then -1 else 1 end) else 0 end) as emitidas_ret_iva,
       count(*) filter (where tipo = 'emitida' and tipo_comprobante = 'I') as emitidas_n,
       sum(case when tipo = 'recibida' and tipo_comprobante = 'I' then total_mxn when tipo = 'recibida' and tipo_comprobante = 'E' then -total_mxn else 0 end) as recibidas_total,
       sum(case when tipo = 'recibida' and tipo_comprobante = 'I' then iva when tipo = 'recibida' and tipo_comprobante = 'E' then -iva else 0 end) as recibidas_iva,
       sum(case when tipo = 'recibida' and tipo_comprobante in ('I','E') and coalesce(uso_cfdi,'') not like 'D%' and coalesce(uso_cfdi,'') <> 'S01'
                then iva * (case when tipo_comprobante = 'E' then -1 else 1 end) else 0 end) as recibidas_iva_acreditable,
       count(*) filter (where tipo = 'recibida' and tipo_comprobante = 'I') as recibidas_n,
       sum(case when tipo = 'nomina' then total else 0 end) as nomina_neto,
       sum(case when tipo = 'nomina' then coalesce((conceptos->0->>'importe')::numeric, total) else 0 end) as nomina_bruto,
       sum(case when tipo = 'nomina' then ret_isr else 0 end) as nomina_isr,
       count(*) filter (where tipo = 'nomina') as nomina_n
  from v_cfdi group by 1, 2),
l as (
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

-- ligar / desligar con varias facturas por gasto
create or replace function ligar_cfdi(p_uuid uuid, p_mov uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update cfdi set movimiento_id = p_mov, estado = 'ligada',
    rubro_id = coalesce(rubro_id, (select rubro_id from movimientos where id = p_mov))
  where uuid = p_uuid and user_id = auth.uid();
  update movimientos set tiene_cfdi = true, cfdi_uuid = coalesce(cfdi_uuid, p_uuid) where id = p_mov and user_id = auth.uid();
end $$;
create or replace function desligar_cfdi(p_uuid uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_mov uuid;
begin
  select coalesce(movimiento_id, (select id from movimientos where cfdi_uuid = p_uuid limit 1)) into v_mov from cfdi where uuid = p_uuid and user_id = auth.uid();
  update cfdi set movimiento_id = null, estado = 'nueva' where uuid = p_uuid and user_id = auth.uid();
  update movimientos set cfdi_uuid = null where cfdi_uuid = p_uuid and user_id = auth.uid();
  if v_mov is not null then
    update movimientos set tiene_cfdi = exists (select 1 from cfdi where movimiento_id = v_mov),
      cfdi_uuid = coalesce(cfdi_uuid, (select uuid from cfdi where movimiento_id = v_mov limit 1)) where id = v_mov;
  end if;
end $$;
grant execute on function ligar_cfdi(uuid, uuid), desligar_cfdi(uuid) to authenticated;

-- al registrar un gasto con cfdi_uuid (Crear gasto desde factura), la factura apunta al gasto
create or replace function trg_mov_cfdi_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cfdi_uuid is not null and (tg_op = 'INSERT' or new.cfdi_uuid is distinct from old.cfdi_uuid) then
    update cfdi set movimiento_id = new.id where uuid = new.cfdi_uuid and movimiento_id is null;
  end if;
  return new;
end $$;
drop trigger if exists t_mov_cfdi_link on movimientos;
create trigger t_mov_cfdi_link after insert or update of cfdi_uuid on movimientos for each row execute function trg_mov_cfdi_link();
