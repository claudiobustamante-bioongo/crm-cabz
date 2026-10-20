-- 21: pestaña Contabilidad (para el contador): ajustes fiscales (pérdidas por amortizar, correcciones)
--     y calendario de obligaciones. Requiere 18.

create table if not exists ajustes_fiscales (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default crm_owner() references auth.users(id) on delete cascade,
  anio      int not null,
  tipo      text not null check (tipo in ('perdida_acciones','perdida_actividad','otro')),
  concepto  text not null,
  monto     numeric(14,2) not null,     -- pérdida: positivo = pérdida pendiente de amortizar
  moneda    char(3) not null default 'MXN',
  amortizado numeric(14,2) not null default 0,
  notas     text,
  creado    timestamptz not null default now()
);
alter table ajustes_fiscales enable row level security;
drop policy if exists owner_all on ajustes_fiscales;
create policy owner_all on ajustes_fiscales for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists obligaciones_fiscales (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default crm_owner() references auth.users(id) on delete cascade,
  anio      int not null,
  mes       int not null check (mes between 1 and 12),
  obligacion text not null,
  vence     date not null,
  estado    text not null default 'pendiente' check (estado in ('pendiente','presentada','pagada','no_aplica')),
  monto     numeric(14,2),
  notas     text,
  unique (user_id, anio, mes, obligacion)
);
alter table obligaciones_fiscales enable row level security;
drop policy if exists owner_all on obligaciones_fiscales;
create policy owner_all on obligaciones_fiscales for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- genera el calendario de un año (pagos provisionales ISR/IVA día 17, DIOT, anual en abril) si no existe
create or replace function generar_obligaciones(p_anio int) returns int
language plpgsql security invoker set search_path = public as $$
declare n int := 0; m int;
begin
  for m in 1..12 loop
    insert into obligaciones_fiscales (anio, mes, obligacion, vence)
    values (p_anio, m, 'Pago provisional ISR e IVA (actividad empresarial)', make_date(p_anio + (m / 12), (m % 12) + 1, 17))
    on conflict do nothing; n := n + 1;
    insert into obligaciones_fiscales (anio, mes, obligacion, vence)
    values (p_anio, m, 'DIOT', make_date(p_anio + (m / 12), (m % 12) + 1, 28) )
    on conflict do nothing;
  end loop;
  insert into obligaciones_fiscales (anio, mes, obligacion, vence) values (p_anio, 4, 'Declaración anual personas físicas', make_date(p_anio + 1, 4, 30)) on conflict do nothing;
  return n;
end $$;
grant execute on function generar_obligaciones(int) to authenticated;

-- vista mensual para el contador: emitidas (honorarios), recibidas (IVA acreditable) y nómina, netas de notas de crédito
drop view if exists v_contab_mensual;
create view v_contab_mensual with (security_invoker = true) as
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
from v_cfdi group by 1, 2;
grant select on v_contab_mensual to authenticated;
grant select, insert, update, delete on ajustes_fiscales, obligaciones_fiscales to authenticated;
