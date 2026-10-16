-- 17: en deducciones solo cuentan facturas de ingreso (I); las notas de crédito (E) restan;
--     complementos de pago (P) y traslados (T) no cuentan ni heredan rubro. Requiere 16.

-- reglas: no aplicar rubro a P/T
create or replace function trg_cfdi_regla_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rubro_id is null and new.tipo = 'recibida' and coalesce(new.tipo_comprobante, 'I') in ('I', 'E') then
    select rubro_id into new.rubro_id from cfdi_reglas where user_id = new.user_id and emisor_rfc = new.emisor_rfc;
    if new.rubro_id is null then new.rubro_id := cfdi_rubro_sugerido(new.user_id, new.uso_cfdi, new.conceptos); end if;
  end if;
  return new;
end $$;

create or replace function trg_cfdi_regla() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rubro_id is not null and new.tipo = 'recibida' and (old.rubro_id is distinct from new.rubro_id) then
    insert into cfdi_reglas (user_id, emisor_rfc, rubro_id) values (new.user_id, new.emisor_rfc, new.rubro_id)
    on conflict (user_id, emisor_rfc) do update set rubro_id = excluded.rubro_id, veces = cfdi_reglas.veces + 1, actualizado = now();
    update cfdi set rubro_id = new.rubro_id
    where user_id = new.user_id and emisor_rfc = new.emisor_rfc and rubro_id is null and tipo = 'recibida'
      and coalesce(tipo_comprobante, 'I') in ('I', 'E');
  end if;
  return new;
end $$;

-- limpia los P/T que ya heredaron rubro
update cfdi set rubro_id = null where tipo = 'recibida' and tipo_comprobante in ('P', 'T') and rubro_id is not null;

drop view if exists v_deducciones_anual;
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

-- revisa: facturas con rubro deducible, para ver si hay dos del mismo emisor y fecha
select c.fecha, c.tipo_comprobante, c.emisor_nombre, c.total_mxn, c.uso_cfdi, r.codigo as rubro, c.uuid
from v_cfdi c join rubros r on r.id = c.rubro_id where r.deduccion is not null order by c.emisor_rfc, c.fecha;
