-- 30: pestaña Akela. Acceso de papás y hermano (solo lectura): presupuesto vs real, aportaciones, saldo del fondo
--     y proyección. Edición del plan por el dueño. Requiere 29.

-- parámetros de proyección (editables desde la pestaña)
alter table app_config
  add column if not exists akela_nac_papa int default 1961,
  add column if not exists akela_nac_mama int default 1962,
  add column if not exists akela_rend_real numeric(6,4) default 0.04,   -- rendimiento real anual en USD
  add column if not exists akela_tc numeric(8,4) default 18.50;
drop policy if exists owner_update_config on app_config;
create policy owner_update_config on app_config for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- familia: aportaciones al fondo (transferencias con destino Fondo Akela) y su detalle
drop policy if exists familia_mov_fondo on movimientos;
create policy familia_mov_fondo on movimientos for select to authenticated using (
  mi_rol() in ('papas','hermano') and tipo = 'transferencia'
  and cuenta_destino_id in (select id from cuentas where tipo = 'fondo'));
drop policy if exists familia_ingresos on ingresos_detalle;
create policy familia_ingresos on ingresos_detalle for select to authenticated using (mi_rol() in ('papas','hermano') and tipo = 'aportacion_akela');
-- familia: saldo del fondo (cuentas cuyo titular no es el dueño: CBZBurguer, Fondo Akela)
drop policy if exists familia_saldos on saldos_cuenta;
create policy familia_saldos on saldos_cuenta for select to authenticated using (
  mi_rol() in ('papas','hermano') and cuenta_id in (select c.id from cuentas c join pagadores p on p.id = c.titular_id where not p.es_titular));
drop policy if exists familia_ibkr on ibkr_estados_mensuales;
create policy familia_ibkr on ibkr_estados_mensuales for select to authenticated using (
  mi_rol() in ('papas','hermano') and cuenta_id in (select c.id from cuentas c join pagadores p on p.id = c.titular_id where not p.es_titular));
drop policy if exists familia_anios on anios;
create policy familia_anios on anios for select to authenticated using (mi_rol() is not null);

-- upsert de una celda del plan (dueño)
create or replace function plan_akela_set(p_anio int, p_linea text, p_mes int, p_monto numeric, p_pagador text default null, p_transferencia boolean default null, p_rubro uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
declare v_pag uuid;
begin
  select id into v_pag from pagadores where user_id = auth.uid() and codigo = coalesce(p_pagador, 'CABZ');
  insert into plan_akela (anio, linea, mes, monto, pagador_id, es_transferencia, rubro_id)
  values (p_anio, p_linea, p_mes, p_monto, v_pag, coalesce(p_transferencia, false), p_rubro)
  on conflict (user_id, anio, linea, mes) do update set monto = excluded.monto,
    pagador_id = case when p_pagador is null then plan_akela.pagador_id else excluded.pagador_id end,
    es_transferencia = coalesce(p_transferencia, plan_akela.es_transferencia),
    rubro_id = coalesce(p_rubro, plan_akela.rubro_id);
end $$;
grant execute on function plan_akela_set(int, text, int, numeric, text, boolean, uuid) to authenticated;

-- vista del plan con códigos (para la app)
drop view if exists v_plan_akela;
create view v_plan_akela with (security_invoker = true) as
select p.id, p.anio, p.linea, p.rubro_id, pg.codigo as pagador, p.es_transferencia, p.mes, p.monto, p.notas
from plan_akela p join pagadores pg on pg.id = p.pagador_id;
grant select on v_plan_akela, v_akela_real_vs_plan, v_libro_akela to authenticated;
