-- 16: clasifica solas las facturas deducibles (GMM y médicas) sin que tengas que ponerles rubro.
--     Se basa en lo que trae el XML: UsoCFDI D07/D01/D02 o la clave SAT del concepto
--     (8413 16xx = seguros de salud / gastos médicos; 85xx xxxx = servicios de salud).
--     Requiere 10 y 13.

create or replace function cfdi_rubro_sugerido(p_user uuid, p_uso text, p_conceptos jsonb)
returns uuid language sql stable security definer set search_path = public as $$
  with claves as (select coalesce(e->>'clave', '') as c from jsonb_array_elements(coalesce(p_conceptos, '[]'::jsonb)) e),
  cat as (
    select case
      when p_uso = 'D07' or exists (select 1 from claves where c like '841316%') then 'gmm'
      when p_uso in ('D01', 'D02') or exists (select 1 from claves where c like '85%') then 'medico'
    end as k)
  select r.id from rubros r, cat
  where cat.k is not null and r.user_id = p_user and r.activo and r.deduccion = cat.k
  order by case r.codigo when 'SEGUROS__GMM' then 0 when 'SEGUROS__SEGURO_GMM' then 1 when 'SALUD__DOCTORES' then 0 when 'SALUD__MEDICO' then 1 else 5 end,
           r.codigo like 'AKELA%', r.codigo
  limit 1
$$;

-- al insertar: primero la regla aprendida del emisor; si no hay, la sugerencia por uso/clave
create or replace function trg_cfdi_regla_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rubro_id is null and new.tipo = 'recibida' then
    select rubro_id into new.rubro_id from cfdi_reglas where user_id = new.user_id and emisor_rfc = new.emisor_rfc;
    if new.rubro_id is null then new.rubro_id := cfdi_rubro_sugerido(new.user_id, new.uso_cfdi, new.conceptos); end if;
  end if;
  return new;
end $$;

-- facturas que ya están: aplica la sugerencia (y con eso aprende la regla del emisor)
update cfdi set rubro_id = cfdi_rubro_sugerido(user_id, uso_cfdi, conceptos)
where tipo = 'recibida' and rubro_id is null and cfdi_rubro_sugerido(user_id, uso_cfdi, conceptos) is not null;

select anio, categoria, registrado, con_comprobante, facturas from v_deducciones_anual order by 1, 2;
