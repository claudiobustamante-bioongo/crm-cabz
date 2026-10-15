-- =====================================================================
-- CRM CABZ · 07_saldos_ibkr.sql
-- El saldo de las cuentas IBKR se deriva SIEMPRE del último mes cargado en
-- ibkr_estados_mensuales (NAV de cierre): trigger + relleno de lo ya existente.
-- Correr DESPUÉS de 06.
-- =====================================================================
create or replace function trg_saldo_ibkr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into saldos_cuenta (user_id, cuenta_id, fecha, saldo, fuente)
  values (new.user_id, new.cuenta_id, (new.periodo + interval '1 month - 1 day')::date, new.nav_final,
          coalesce('IBKR · ' || new.fuente, 'IBKR estado de cuenta'))
  on conflict (cuenta_id, fecha) do update set saldo = excluded.saldo, fuente = excluded.fuente;
  return new;
end $$;

drop trigger if exists t_saldo_ibkr on ibkr_estados_mensuales;
create trigger t_saldo_ibkr after insert or update of nav_final on ibkr_estados_mensuales
  for each row execute function trg_saldo_ibkr();

-- Relleno: un saldo por cada mes ya cargado
insert into saldos_cuenta (user_id, cuenta_id, fecha, saldo, fuente)
select user_id, cuenta_id, (periodo + interval '1 month - 1 day')::date, nav_final, coalesce('IBKR · ' || fuente, 'IBKR estado de cuenta')
from ibkr_estados_mensuales
on conflict (cuenta_id, fecha) do update set saldo = excluded.saldo, fuente = excluded.fuente;

select c.nombre, s.fecha, s.saldo from v_saldo_actual s join cuentas c on c.id = s.cuenta_id where c.tipo = 'inversion';
