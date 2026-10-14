-- =====================================================================
-- CRM CABZ · 04_migracion_v2.sql
-- Lleva el esquema al prototipo v8: catálogo como el Excel con N/G/A/D,
-- ingresos con desglose fiscal, plan Akela por año/línea/mes, saldos de
-- retiro con historial, roles de lectura, importaciones trazables,
-- IBKR por clase de activo. Sin datos personales: se puede versionar.
-- Correr DESPUÉS de 01–03 en el SQL Editor (sin RLS, el script lo maneja).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rubros: clasificación N/G/A/D y nivel explícito
-- ---------------------------------------------------------------------
create type clasificacion_gasto as enum ('N','G','A','D');  -- necesidad, gusto, ahorro, deuda
alter table rubros add column if not exists clasificacion clasificacion_gasto;
alter table rubros add column if not exists emoji text;
alter table rubros add column if not exists anio_desde int not null default 2026;  -- catálogo vive año con año; nunca se borra
-- subrubro hereda la clasificación del padre si no trae propia
create or replace function rubro_cls(p uuid) returns clasificacion_gasto
language sql stable as $$
  select coalesce(r.clasificacion, p.clasificacion, 'G')
  from rubros r left join rubros p on p.id = r.padre_id where r.id = $1
$$;

-- ---------------------------------------------------------------------
-- 2. Ingresos: tipo y desglose fiscal sobre el movimiento tipo 'ingreso'
-- ---------------------------------------------------------------------
create type tipo_ingreso as enum ('sueldo','comision','bono','dividendo_interes','reembolso','aportacion_akela','otro');
create table ingresos_detalle (
  movimiento_id  uuid primary key references movimientos(id) on delete cascade,
  user_id        uuid not null default crm_owner() references auth.users(id) on delete cascade,
  tipo           tipo_ingreso not null,
  bruto          numeric(14,2),            -- honorarios (comisión)
  iva            numeric(14,2) not null default 0,
  ret_isr        numeric(14,2) not null default 0,
  ret_iva        numeric(14,2) not null default 0,
  cliente        text,
  proyectado     boolean not null default false,   -- bono / sueldo esperado; se reemplaza al capturar
  aporta_id      uuid references pagadores(id)      -- aportación Akela: quién la pone
);

-- Una aportación a Akela no es ingreso tuyo: entra al fondo.
-- registrar_ingreso() es la puerta única: crea el movimiento y su detalle.
create or replace function registrar_ingreso(p jsonb) returns uuid
language plpgsql as $$
declare v_uid uuid := crm_owner(); v_id uuid; v_tipo tipo_ingreso := (p->>'tipo')::tipo_ingreso;
        v_cta uuid; v_fondo uuid; v_lib uuid; v_rub uuid; v_bruto numeric; v_pm boolean;
        v_iva numeric := 0; v_risr numeric := 0; v_riva numeric := 0; v_monto numeric;
begin
  if v_tipo = 'aportacion_akela' and p->>'cuenta' is null then
    -- sale de la cuenta de quien aporta (p.ej. "Aportaciones Luis Miguel", cuenta externa del hermano)
    v_cta := (select c.id from cuentas c join pagadores g on g.id = c.titular_id
               where c.user_id = v_uid and g.codigo = coalesce(p->>'aporta','HAMB') and c.tipo = 'cheques'
               order by c.es_medio_pago desc limit 1);
  else
    v_cta := (select id from cuentas where user_id = v_uid and nombre = coalesce(p->>'cuenta','Cheques'));
  end if;
  if v_cta is null then raise exception 'Cuenta no encontrada: %', coalesce(p->>'cuenta', 'cuenta de ' || coalesce(p->>'aporta','HAMB')); end if;
  v_lib := (select id from libros where user_id = v_uid and codigo =
             case v_tipo when 'comision' then 'BIOONGO' when 'reembolso' then 'CORDADA' when 'aportacion_akela' then 'AKELA' else 'PERSONAL' end);
  v_rub := (select id from rubros where user_id = v_uid and codigo =
             case v_tipo when 'sueldo' then 'ING_SUELDO' when 'bono' then 'ING_BONO' when 'comision' then 'ING_HONORARIOS'
                         when 'dividendo_interes' then 'ING_RENDIMIENTOS' else 'ING_OTROS' end);
  v_monto := (p->>'monto')::numeric;
  if v_tipo = 'comision' then
    v_bruto := (p->>'bruto')::numeric; v_pm := coalesce((p->>'persona_moral')::boolean, true);
    v_iva := round(v_bruto * 0.16, 2);
    if v_pm then v_risr := round(v_bruto * 0.10, 2); v_riva := round(v_iva * 2/3, 2); end if;
    v_monto := coalesce(v_monto, v_bruto + v_iva - v_risr - v_riva);
  end if;

  if v_tipo = 'aportacion_akela' then
    -- transferencia al Fondo Akela desde la cuenta origen (o desde "externo" si la pone el hermano)
    v_fondo := (select id from cuentas where user_id = v_uid and nombre = 'Fondo Akela');
    insert into movimientos (user_id, fecha, tipo, estado, descripcion, monto, cuenta_id, cuenta_destino_id, contraparte_id, notas)
    values (v_uid, (p->>'fecha')::date, 'transferencia', 'real', coalesce(p->>'descripcion','Aportación Akela'), v_monto,
            v_cta, v_fondo, (select id from pagadores where user_id = v_uid and codigo = coalesce(p->>'aporta','HAMB')), p->>'notas')
    returning id into v_id;
  else
    insert into movimientos (user_id, fecha, tipo, estado, descripcion, monto, cuenta_id, rubro_id, contraparte_id, cfdi_uuid, tiene_cfdi, notas)
    values (v_uid, (p->>'fecha')::date, case v_tipo when 'reembolso' then 'reembolso'::tipo_movimiento else 'ingreso' end,
            case when coalesce((p->>'proyectado')::boolean,false) then 'presupuesto'::estado_movimiento else 'real' end,
            coalesce(p->>'descripcion', v_tipo::text), v_monto, v_cta,
            case when v_tipo = 'reembolso' then null else v_rub end,
            -- reembolso: quién te devuelve (Cordada → se registra como pagador CABZ a falta de tercero)
            case when v_tipo = 'reembolso' then (select id from pagadores where user_id = v_uid and codigo = coalesce(p->>'contraparte','CABZ')) end,
            (p->>'cfdi_uuid')::uuid, (p->>'cfdi_uuid') is not null, p->>'notas')
    returning id into v_id;
    if v_tipo <> 'reembolso' then
      insert into asignaciones (user_id, movimiento_id, libro_id, pagador_id, monto)
      values (v_uid, v_id, v_lib, (select id from pagadores where user_id = v_uid and es_titular), v_monto);
    end if;
  end if;

  insert into ingresos_detalle (movimiento_id, user_id, tipo, bruto, iva, ret_isr, ret_iva, cliente, proyectado, aporta_id)
  values (v_id, v_uid, v_tipo, v_bruto, v_iva, v_risr, v_riva, p->>'cliente', coalesce((p->>'proyectado')::boolean,false),
          case when v_tipo = 'aportacion_akela' then (select id from pagadores where user_id = v_uid and codigo = coalesce(p->>'aporta','HAMB')) end);

  -- capturar un mes real reemplaza su proyección del mismo tipo
  if not coalesce((p->>'proyectado')::boolean,false) then
    delete from movimientos m using ingresos_detalle d
     where d.movimiento_id = m.id and d.proyectado and d.tipo = v_tipo and m.user_id = v_uid
       and date_trunc('month', m.fecha) = date_trunc('month', (p->>'fecha')::date) and m.id <> v_id;
  end if;
  return v_id;
end $$;

-- reembolso ya no exige rubro (viene de ingresos_detalle)
alter table movimientos drop constraint if exists mov_rubro_req;
alter table movimientos add constraint mov_rubro_req check (tipo not in ('gasto','ingreso') or rubro_id is not null);

-- ---------------------------------------------------------------------
-- 3. Plan Akela por año, línea y mes (editable; líneas nuevas entran en 0)
-- ---------------------------------------------------------------------
create table plan_akela (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default crm_owner() references auth.users(id) on delete cascade,
  anio           int not null,
  linea          text not null,                     -- = nombre del subrubro de Akela
  rubro_id       uuid references rubros(id),         -- subrubro ligado (para real vs plan)
  pagador_id     uuid not null references pagadores(id),
  es_transferencia boolean not null default false,  -- pago fijo a papá/mamá (sale del fondo)
  mes            int not null check (mes between 1 and 12),
  monto          numeric(14,2) not null default 0,
  notas          text,
  unique (user_id, anio, linea, mes)
);
create index on plan_akela (user_id, anio);

-- Salida mensual del fondo = líneas CABZ + transferencias a papá/mamá
create view v_plan_akela_mes with (security_invoker = true) as
select anio, mes,
       sum(monto) filter (where es_transferencia or p.codigo = 'CABZ') as salida_fondo,
       sum(monto) filter (where p.codigo = 'CABU' and not es_transferencia) as cubre_papa,
       sum(monto) filter (where p.codigo = 'MPZB' and not es_transferencia) as cubre_mama
from plan_akela a join pagadores p on p.id = a.pagador_id
group by anio, mes;

-- Real vs plan por línea y mes (real = porciones del libro AKELA por subrubro)
create view v_akela_real_vs_plan with (security_invoker = true) as
with plan as (
  select anio, mes, linea, rubro_id, sum(monto) as plan
  from plan_akela where es_transferencia or pagador_id = (select id from pagadores where codigo = 'CABZ' limit 1)
  group by 1,2,3,4),
real as (
  select extract(year from m.fecha)::int as anio, extract(month from m.fecha)::int as mes,
         coalesce(r.nombre, 'Sin subrubro') as linea, m.rubro_id, sum(a.monto) as real
  from asignaciones a join movimientos m on m.id = a.movimiento_id
  join libros l on l.id = a.libro_id and l.codigo = 'AKELA'
  left join rubros r on r.id = m.rubro_id
  where m.tipo = 'gasto' and m.estado = 'real'
  group by 1,2,3,4)
select coalesce(p.anio, x.anio) as anio, coalesce(p.mes, x.mes) as mes, coalesce(p.linea, x.linea) as linea,
       coalesce(p.rubro_id, x.rubro_id) as rubro_id,
       coalesce(p.plan, 0) as plan, coalesce(x.real, 0) as real, coalesce(x.real,0) - coalesce(p.plan,0) as desviacion
from plan p full join real x on x.anio = p.anio and x.mes = p.mes and x.linea = p.linea;

-- ---------------------------------------------------------------------
-- 4. Cuentas de retiro y saldos con historial (AFORE, PPR, Enso…)
-- ---------------------------------------------------------------------
-- Postgres no deja usar un valor nuevo de enum en la misma transacción: por eso las vistas comparan c.tipo::text
alter type tipo_cuenta add value if not exists 'retiro';
create table saldos_cuenta (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default crm_owner() references auth.users(id) on delete cascade,
  cuenta_id  uuid not null references cuentas(id) on delete cascade,
  fecha      date not null,
  saldo      numeric(16,2) not null,
  fuente     text not null default 'captura manual',   -- manual · estado de cuenta · IBKR
  unique (cuenta_id, fecha)
);
create view v_saldo_actual with (security_invoker = true) as
select distinct on (cuenta_id) cuenta_id, fecha, saldo, fuente
from saldos_cuenta order by cuenta_id, fecha desc;

-- Saldo contable: saldo_inicial es el saldo A LA FECHA fecha_saldo_inicial; solo
-- suman los movimientos posteriores. Así la historia del Excel no distorsiona
-- el saldo de hoy (Cheques, AMEX, TDC se fijan al corte de octubre 2026).
create or replace view v_saldo_cuentas with (security_invoker = true) as
with mov as (
  select m.cuenta_id as cuenta_id, m.fecha,
         case when m.tipo in ('ingreso','reembolso') then 1 else -1 end *
         case when m.moneda = c.moneda then m.monto
              when m.monto_cuenta is not null then m.monto_cuenta
              else round(m.monto * tc_mxn(m.moneda, m.fecha) / tc_mxn(c.moneda, m.fecha), 2) end as importe
  from movimientos m join cuentas c on c.id = m.cuenta_id
  where m.estado = 'real'
  union all
  select m.cuenta_destino_id, m.fecha,
         case when m.moneda = c.moneda then m.monto
              else round(m.monto * tc_mxn(m.moneda, m.fecha) / tc_mxn(c.moneda, m.fecha), 2) end
  from movimientos m join cuentas c on c.id = m.cuenta_destino_id
  where m.estado = 'real' and m.cuenta_destino_id is not null)
select c.id, c.nombre, c.tipo, c.moneda,
       c.saldo_inicial + coalesce(sum(mov.importe) filter (where c.fecha_saldo_inicial is null or mov.fecha > c.fecha_saldo_inicial), 0) as saldo,
       round((c.saldo_inicial + coalesce(sum(mov.importe) filter (where c.fecha_saldo_inicial is null or mov.fecha > c.fecha_saldo_inicial), 0))
             * tc_mxn(c.moneda, current_date), 2) as saldo_mxn
from cuentas c left join mov on mov.cuenta_id = c.id
where c.tipo <> 'prestamo' and c.activa
group by c.id;

-- Net worth personal (solo tuyo: excluye Fondo Akela y cuentas cuyo titular no eres tú, p.ej. CBZBurguer)
--  · retiro / inversión: último saldo capturado (AFORE, PPR, NAV de IBKR) × TC de hoy
--  · cheques y tarjetas: saldo contable
--  · préstamos: saldo vivo de v_deudas
create or replace view v_net_worth with (security_invoker = true) as
with mias as (select c.* from cuentas c join pagadores p on p.id = c.titular_id and p.es_titular where c.activa)
select
  (select coalesce(sum(s.saldo * tc_mxn(c.moneda, current_date)),0)
     from v_saldo_actual s join mias c on c.id = s.cuenta_id where c.tipo::text in ('retiro','inversion')) as retiro_inversion_mxn,
  (select coalesce(sum(v.saldo_mxn),0) from v_saldo_cuentas v join mias c on c.id = v.id where c.tipo = 'cheques') as efectivo_mxn,
  (select coalesce(sum(-v.saldo_mxn),0) from v_saldo_cuentas v join mias c on c.id = v.id where c.tipo = 'tarjeta_credito') as tarjetas_mxn,
  (select coalesce(sum(saldo_actual * tc_mxn(moneda, current_date)),0) from v_deudas) as prestamos_mxn,
  (select coalesce(sum(s.saldo * tc_mxn(c.moneda, current_date)),0)
     from v_saldo_actual s join mias c on c.id = s.cuenta_id where c.tipo::text in ('retiro','inversion'))
  + (select coalesce(sum(v.saldo_mxn),0) from v_saldo_cuentas v join mias c on c.id = v.id where c.tipo = 'cheques')
  - (select coalesce(sum(-v.saldo_mxn),0) from v_saldo_cuentas v join mias c on c.id = v.id where c.tipo = 'tarjeta_credito')
  - (select coalesce(sum(saldo_actual * tc_mxn(moneda, current_date)),0) from v_deudas) as neto_mxn;

-- ---------------------------------------------------------------------
-- 5. Roles de lectura (contador, papás, hermano)
-- ---------------------------------------------------------------------
create type rol_acceso as enum ('dueno','contador','papas','hermano');
create table accesos (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  rol      rol_acceso not null,
  nombre   text,
  otorgado_por uuid not null default crm_owner() references auth.users(id)
);
create or replace function mi_rol() returns rol_acceso
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = (select owner_id from app_config where id) then 'dueno'::rol_acceso
              else (select rol from accesos where user_id = auth.uid()) end
$$;
grant execute on function mi_rol() to authenticated;

-- Lectura por rol. El dueño ya tiene owner_all en todas las tablas.
create policy contador_cfdi   on cfdi                   for select to authenticated using (mi_rol() = 'contador');
create policy contador_ibkr   on ibkr_estados_mensuales for select to authenticated using (mi_rol() = 'contador');
create policy contador_docs   on documentos             for select to authenticated using (mi_rol() = 'contador' and categoria in ('cfdi','estado_cuenta'));
create policy contador_ingresos on ingresos_detalle     for select to authenticated using (mi_rol() = 'contador');
create policy familia_plan    on plan_akela             for select to authenticated using (mi_rol() in ('papas','hermano'));
create policy familia_catalogos_l on libros             for select to authenticated using (mi_rol() is not null);
create policy familia_catalogos_r on rubros             for select to authenticated using (mi_rol() is not null);
create policy familia_catalogos_p on pagadores          for select to authenticated using (mi_rol() is not null);
create policy familia_catalogos_c on cuentas            for select to authenticated using (mi_rol() is not null);
-- papás y hermano ven solo movimientos con porción Akela
create policy familia_mov on movimientos for select to authenticated using (
  mi_rol() in ('papas','hermano') and exists (
    select 1 from asignaciones a join libros l on l.id = a.libro_id
    where a.movimiento_id = movimientos.id and l.codigo = 'AKELA'));
create policy familia_asig on asignaciones for select to authenticated using (
  mi_rol() in ('papas','hermano') and exists (select 1 from libros l where l.id = asignaciones.libro_id and l.codigo = 'AKELA'));
-- el hermano puede registrar su aportación (movimiento transferencia al fondo)
alter table ingresos_detalle enable row level security;
create policy owner_all on ingresos_detalle for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table plan_akela enable row level security;
create policy owner_all on plan_akela for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table saldos_cuenta enable row level security;
create policy owner_all on saldos_cuenta for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table accesos enable row level security;
create policy owner_all on accesos for all to authenticated using (otorgado_por = auth.uid()) with check (otorgado_por = auth.uid());
create policy self_read on accesos for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. Importaciones trazables + IBKR por clase de activo (como Datos_IB)
-- ---------------------------------------------------------------------
create type tipo_importacion as enum ('ibkr_csv','cfdi_xml','pdf_ia','excel');
create table importaciones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default crm_owner() references auth.users(id) on delete cascade,
  tipo         tipo_importacion not null,
  archivo      text not null,
  documento_id uuid references documentos(id),
  cuenta_id    uuid references cuentas(id),
  periodo      date,
  filas        int not null default 0,
  resultado    jsonb,
  created_at   timestamptz not null default now()
);
alter table importaciones enable row level security;
create policy owner_all on importaciones for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table ibkr_estados_mensuales
  add column if not exists importacion_id uuid references importaciones(id),
  add column if not exists moneda_base char(3) not null default 'USD',
  add column if not exists real_etf numeric(14,2) not null default 0,
  add column if not exists real_acc numeric(14,2) not null default 0,
  add column if not exists real_opc numeric(14,2) not null default 0,
  add column if not exists real_fx  numeric(14,2) not null default 0,
  add column if not exists real_bono numeric(14,2) not null default 0,
  add column if not exists nr_etf  numeric(14,2) not null default 0,
  add column if not exists nr_acc  numeric(14,2) not null default 0,
  add column if not exists nr_opc  numeric(14,2) not null default 0,
  add column if not exists nr_fx   numeric(14,2) not null default 0,
  add column if not exists nr_bono numeric(14,2) not null default 0,
  add column if not exists div_bruto numeric(14,2) not null default 0,
  add column if not exists div_ret   numeric(14,2) not null default 0,
  add column if not exists cupon     numeric(14,2) not null default 0,
  add column if not exists cupon_ret numeric(14,2) not null default 0,
  add column if not exists int_broker numeric(14,2) not null default 0,
  add column if not exists nav_efe  numeric(14,2) not null default 0,
  add column if not exists nav_acc  numeric(14,2) not null default 0,
  add column if not exists nav_opc  numeric(14,2) not null default 0,
  add column if not exists nav_bono numeric(14,2) not null default 0,
  add column if not exists nav_dev  numeric(14,2) not null default 0;
comment on column ibkr_estados_mensuales.moneda_base is 'Los importes por clase están en la moneda base de IB (USD); MXN se calcula con tipos_cambio al FIX del mes.';

-- Panel fiscal anual (misma metodología que Panel Contable CABZ): USD × FIX del mes
create view v_ibkr_panel with (security_invoker = true) as
select e.cuenta_id, c.nombre as cuenta, extract(year from e.periodo)::int as anio, extract(month from e.periodo)::int as mes,
       tc_mxn('USD', e.periodo) as tc,
       (e.real_etf + e.real_acc + e.real_opc + e.real_fx + e.real_bono) as realizada_usd,
       (e.nr_etf + e.nr_acc + e.nr_opc + e.nr_fx + e.nr_bono)           as no_realizada_usd,
       (e.div_bruto - e.div_ret + e.cupon)                               as pasivos_usd,
       (e.comisiones + e.int_broker)                                     as costos_usd,
       e.nav_final as nav_usd, e.depositos as depositos_usd,
       e.div_bruto, e.div_ret, e.cupon,
       round(greatest(0, e.div_bruto) * 0.10, 2) as isr_dividendos_usd,
       round(greatest(0, e.cupon) * 0.35, 2)     as isr_cupones_usd
from ibkr_estados_mensuales e join cuentas c on c.id = e.cuenta_id;

-- ---------------------------------------------------------------------
-- 7. Año fiscal: cierre que deja 2026 como histórico y abre 2027 limpio
-- ---------------------------------------------------------------------
create table anios (
  anio      int primary key,
  abierto   boolean not null default true,
  cerrado_en timestamptz
);
insert into anios (anio) values (2026), (2027) on conflict do nothing;
-- Propone el plan del año siguiente = promedio real del año anterior por línea Akela
create or replace function proponer_plan_akela(p_de int, p_a int) returns int
language plpgsql as $$
declare n int;
begin
  insert into plan_akela (user_id, anio, linea, rubro_id, pagador_id, es_transferencia, mes, monto)
  select crm_owner(), p_a, x.linea, x.rubro_id, (select id from pagadores where codigo='CABZ' and user_id = crm_owner()), false, g.mes,
         round(x.total / 12, 2)
  from (select linea, rubro_id, sum(real) as total from v_akela_real_vs_plan where anio = p_de group by 1,2) x
  cross join generate_series(1,12) as g(mes)
  on conflict (user_id, anio, linea, mes) do nothing;
  get diagnostics n = row_count; return n;
end $$;
