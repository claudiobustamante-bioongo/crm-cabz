-- =====================================================================
-- CRM CABZ · 01_schema.sql
-- Esquema base. Sin datos personales: se puede versionar en git.
-- Correr completo en el SQL Editor del proyecto crm-cabz (Supabase).
-- Requiere Postgres 15+ (Supabase lo es).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. Dueño único del sistema
-- ---------------------------------------------------------------------
create table app_config (
  id           boolean primary key default true check (id),   -- una sola fila
  owner_id     uuid not null references auth.users(id) on delete cascade,
  moneda_base  char(3) not null default 'MXN'
);

-- auth.uid() desde la app; el dueño configurado cuando corres SQL a mano.
create or replace function crm_owner() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid(), (select owner_id from app_config where id))
$$;
revoke all on function crm_owner() from public;
grant execute on function crm_owner() to authenticated, service_role;

create or replace function set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------
create type tipo_movimiento as enum
  ('gasto','ingreso','transferencia','abono_deuda','ahorro','reembolso');
-- gasto / abono_deuda / transferencia / ahorro : cuenta_id = de dónde sale
-- ingreso / reembolso                          : cuenta_id = dónde entra
-- reembolso = dinero que te regresa un pagador (CABU, Hamburguesa…) o Cordada

create type estado_movimiento   as enum ('real','presupuesto');
create type tipo_cuenta         as enum ('cheques','tarjeta_credito','prestamo','inversion','fondo');
create type naturaleza_rubro    as enum ('gasto','ingreso');
create type periodicidad_pago   as enum ('mensual','trimestral');
create type metodo_amortizacion as enum ('frances','capital_fijo');
create type estado_amortizacion as enum ('proyectado','pagado');
create type tipo_cfdi           as enum ('emitida','recibida');

-- ---------------------------------------------------------------------
-- 2. Catálogos
-- ---------------------------------------------------------------------
create table libros (            -- de quién es el gasto
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default crm_owner() references auth.users(id) on delete cascade,
  codigo      text not null,     -- PERSONAL, AKELA, BIOONGO, PERIPLO, CORDADA
  nombre      text not null,
  descripcion text,
  activo      boolean not null default true,
  unique (user_id, codigo)
);

create table pagadores (         -- quién pone el dinero
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default crm_owner() references auth.users(id) on delete cascade,
  codigo      text not null,     -- CABZ, CABU, MPZB, HAMB
  nombre      text not null,
  es_titular  boolean not null default false,   -- true solo para ti (CABZ)
  activo      boolean not null default true,
  unique (user_id, codigo)
);
create unique index pagadores_un_titular on pagadores(user_id) where es_titular;

create table rubros (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default crm_owner() references auth.users(id) on delete cascade,
  codigo      text not null,
  nombre      text not null,
  naturaleza  naturaleza_rubro not null default 'gasto',
  padre_id    uuid references rubros(id),
  orden       int not null default 0,
  activo      boolean not null default true,
  unique (user_id, codigo)
);

create table eventos (           -- viajes, obras, bodas…
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default crm_owner() references auth.users(id) on delete cascade,
  nombre       text not null,
  fecha_inicio date,
  fecha_fin    date,
  notas        text,
  unique (user_id, nombre)
);

create table cuentas (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default crm_owner() references auth.users(id) on delete cascade,
  nombre               text not null,
  tipo                 tipo_cuenta not null,
  moneda               char(3) not null default 'MXN',
  titular_id           uuid references pagadores(id),
  es_medio_pago        boolean not null default false,
  institucion          text,
  saldo_inicial        numeric(14,2) not null default 0,  -- tarjetas: negativo = deuda
  fecha_saldo_inicial  date,
  activa               boolean not null default true,
  notas                text,
  unique (user_id, nombre)
);

-- Tipo de cambio a MXN (FIX Banxico). Global, sin user_id.
create table tipos_cambio (
  fecha   date not null,
  moneda  char(3) not null,
  tc_mxn  numeric(12,6) not null check (tc_mxn > 0),
  fuente  text not null default 'Banxico FIX',
  primary key (fecha, moneda)
);

create or replace function tc_mxn(p_moneda char(3), p_fecha date) returns numeric
language sql stable as $$
  select case when p_moneda = 'MXN' then 1::numeric else
    (select tc_mxn from tipos_cambio
      where moneda = p_moneda and fecha <= p_fecha
      order by fecha desc limit 1) end
$$;

-- ---------------------------------------------------------------------
-- 3. Documentos (archivos en Storage, bucket privado "documentos")
-- ---------------------------------------------------------------------
create table documentos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default crm_owner() references auth.users(id) on delete cascade,
  nombre          text not null,
  storage_path    text not null unique,   -- <user_id>/<año>/<archivo>
  mime            text,
  tamano_bytes    bigint,
  categoria       text not null default 'otro'
                  check (categoria in ('estado_cuenta','cfdi','contrato','proyeccion','comprobante','otro')),
  cuenta_id       uuid references cuentas(id),
  fecha_documento date,
  notas           text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. CFDI (importados del Panel de Facturas). UUID SAT = llave: sin duplicados.
-- ---------------------------------------------------------------------
create table cfdi (
  uuid             uuid primary key,
  user_id          uuid not null default crm_owner() references auth.users(id) on delete cascade,
  tipo             tipo_cfdi not null,
  fecha            date not null,
  serie            text,
  folio            text,
  emisor_rfc       text not null,
  emisor_nombre    text,
  receptor_rfc     text not null,
  receptor_nombre  text,
  concepto         text,
  categoria        text,
  uso_cfdi         text,
  subtotal         numeric(14,2) not null,
  descuento        numeric(14,2) not null default 0,
  iva              numeric(14,2) not null default 0,
  ret_isr          numeric(14,2) not null default 0,
  ret_iva          numeric(14,2) not null default 0,
  total            numeric(14,2) not null,
  moneda           char(3) not null default 'MXN',
  tc               numeric(12,6),
  forma_pago       text,
  metodo_pago      text,
  xml_documento_id uuid references documentos(id),
  pdf_documento_id uuid references documentos(id),
  link_drive       text,
  notas            text,
  created_at       timestamptz not null default now(),
  -- cuadre: subtotal - descuento + iva - retenciones = total (tolerancia 1 peso)
  constraint cfdi_cuadre check (abs(subtotal - descuento + iva - ret_isr - ret_iva - total) <= 1)
);

-- ---------------------------------------------------------------------
-- 5. Movimientos + reparto por libro/pagador
-- ---------------------------------------------------------------------
create table movimientos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default crm_owner() references auth.users(id) on delete cascade,
  fecha             date not null,
  tipo              tipo_movimiento not null,
  estado            estado_movimiento not null default 'real',
  descripcion       text not null,
  monto             numeric(14,2) not null check (monto > 0),
  moneda            char(3) not null default 'MXN',
  monto_cuenta      numeric(14,2) check (monto_cuenta > 0), -- lo que realmente se movió en la moneda de la cuenta, si difiere
  cuenta_id         uuid not null references cuentas(id),
  cuenta_destino_id uuid references cuentas(id),
  rubro_id          uuid references rubros(id),
  evento_id         uuid references eventos(id),
  contraparte_id    uuid references pagadores(id),      -- quién reembolsa / quién aporta
  tiene_cfdi        boolean not null default false,
  cfdi_uuid         uuid references cfdi(uuid),
  documento_id      uuid references documentos(id),
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint mov_rubro_req   check (tipo not in ('gasto','ingreso') or rubro_id is not null),
  constraint mov_destino_req check (tipo not in ('transferencia','abono_deuda','ahorro') or cuenta_destino_id is not null),
  constraint mov_destino_dif check (cuenta_destino_id is null or cuenta_destino_id <> cuenta_id),
  constraint mov_reemb_req   check (tipo <> 'reembolso' or contraparte_id is not null),
  constraint mov_cfdi_flag   check (cfdi_uuid is null or tiene_cfdi)
);
create index on movimientos (user_id, fecha);
create index on movimientos (cuenta_id);
create index on movimientos (cuenta_destino_id);
create unique index movimientos_cfdi_unico on movimientos(cfdi_uuid) where cfdi_uuid is not null;
create trigger trg_mov_updated before update on movimientos
  for each row execute function set_updated_at();

create table asignaciones (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default crm_owner() references auth.users(id) on delete cascade,
  movimiento_id  uuid not null references movimientos(id) on delete cascade,
  libro_id       uuid not null references libros(id),
  pagador_id     uuid not null references pagadores(id),
  monto          numeric(14,2) not null check (monto > 0),   -- en la moneda del movimiento
  unique (movimiento_id, libro_id, pagador_id)
);
create index on asignaciones (libro_id);
create index on asignaciones (pagador_id);

-- Regla: en gasto/ingreso el reparto suma exactamente el monto. Se valida al
-- final de la transacción (por eso se captura con registrar_movimiento()).
create or replace function chk_reparto(p_mov uuid) returns void
language plpgsql as $$
declare v_tipo tipo_movimiento; v_monto numeric; v_suma numeric;
begin
  select tipo, monto into v_tipo, v_monto from movimientos where id = p_mov;
  if not found or v_tipo not in ('gasto','ingreso') then return; end if;
  select coalesce(sum(monto),0) into v_suma from asignaciones where movimiento_id = p_mov;
  if v_suma <> v_monto then
    raise exception 'Reparto no cuadra en movimiento %: asignado % vs monto %', p_mov, v_suma, v_monto
      using errcode = 'check_violation';
  end if;
end $$;

create or replace function trg_chk_reparto() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'movimientos' then
    perform chk_reparto(new.id);
  else
    perform chk_reparto(coalesce(new.movimiento_id, old.movimiento_id));
    if tg_op = 'UPDATE' and new.movimiento_id <> old.movimiento_id then
      perform chk_reparto(old.movimiento_id);
    end if;
  end if;
  return null;
end $$;

create constraint trigger ct_reparto_mov after insert or update on movimientos
  deferrable initially deferred for each row execute function trg_chk_reparto();
create constraint trigger ct_reparto_asig after insert or update or delete on asignaciones
  deferrable initially deferred for each row execute function trg_chk_reparto();

-- ---------------------------------------------------------------------
-- 6. Presupuesto mensual
-- ---------------------------------------------------------------------
create table presupuestos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default crm_owner() references auth.users(id) on delete cascade,
  mes         date not null check (extract(day from mes) = 1),
  libro_id    uuid not null references libros(id),
  rubro_id    uuid not null references rubros(id),
  pagador_id  uuid references pagadores(id),
  monto       numeric(14,2) not null check (monto >= 0),
  moneda      char(3) not null default 'MXN',
  notas       text,
  unique nulls not distinct (user_id, mes, libro_id, rubro_id, pagador_id)
);

-- ---------------------------------------------------------------------
-- 7. Deudas y tabla de amortización
-- ---------------------------------------------------------------------
create table deudas (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default crm_owner() references auth.users(id) on delete cascade,
  cuenta_id               uuid not null unique references cuentas(id),
  metodo                  metodo_amortizacion not null,
  tasa_anual              numeric(9,6) not null check (tasa_anual >= 0),
  tasa_es_implicita       boolean not null default false,  -- despejada, no contractual
  periodicidad            periodicidad_pago not null,
  pago_periodico          numeric(14,2),     -- francés
  capital_fijo            numeric(14,2),     -- capital fijo (FIDERH)
  interes_fijo_periodo    numeric(14,2) not null default 0,  -- p.ej. intereses de periodo de gracia
  iva_sobre_interes       numeric(5,4) not null default 0,   -- 0.16 en FIDERH
  seguro_estimado         numeric(14,2) not null default 0,
  saldo_referencia        numeric(14,2) not null check (saldo_referencia >= 0),
  fecha_saldo_referencia  date not null,
  primer_pago_pendiente   date not null,
  numero_primer_pendiente int not null default 1,
  fecha_fin_contractual   date,
  notas                   text,
  constraint deuda_param check (
    (metodo = 'frances'      and pago_periodico is not null) or
    (metodo = 'capital_fijo' and capital_fijo   is not null))
);

create table amortizacion (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default crm_owner() references auth.users(id) on delete cascade,
  deuda_id       uuid not null references deudas(id) on delete cascade,
  numero         int not null,
  fecha          date not null,
  saldo_inicial  numeric(14,2) not null,
  capital        numeric(14,2) not null,
  interes        numeric(14,2) not null,
  interes_fijo   numeric(14,2) not null default 0,
  iva            numeric(14,2) not null default 0,
  seguro         numeric(14,2) not null default 0,
  pago_total     numeric(14,2) not null,
  saldo_final    numeric(14,2) not null,
  estado         estado_amortizacion not null default 'proyectado',
  movimiento_id  uuid references movimientos(id) on delete set null,
  unique (deuda_id, numero)
);

-- Regenera los pagos proyectados desde saldo_referencia. Los pagados no se tocan.
create or replace function generar_amortizacion(p_deuda uuid) returns int
language plpgsql as $$
declare
  d deudas%rowtype;
  v_saldo numeric(14,2); v_fecha date; v_num int; v_n int := 0;
  v_r numeric; v_step interval;
  v_cap numeric(14,2); v_int numeric(14,2); v_iva numeric(14,2); v_tot numeric(14,2);
begin
  select * into d from deudas where id = p_deuda;
  if not found then raise exception 'Deuda % no existe', p_deuda; end if;

  delete from amortizacion where deuda_id = p_deuda and estado = 'proyectado';

  v_step := case d.periodicidad when 'mensual' then interval '1 month' else interval '3 months' end;
  v_r    := d.tasa_anual / case d.periodicidad when 'mensual' then 12 else 4 end;
  v_saldo := d.saldo_referencia;
  v_num   := d.numero_primer_pendiente;

  while v_saldo > 0 and v_n < 600 loop
    v_fecha := (d.primer_pago_pendiente + v_step * v_n)::date;
    v_int := round(v_saldo * v_r, 2);
    if d.metodo = 'frances' then
      if d.pago_periodico <= v_int then
        raise exception 'El pago % no cubre los intereses % (deuda %)', d.pago_periodico, v_int, p_deuda;
      end if;
      v_cap := least(d.pago_periodico - v_int, v_saldo);
    else
      v_cap := least(d.capital_fijo, v_saldo);
    end if;
    if v_saldo - v_cap < 1 then v_cap := v_saldo; end if;   -- sin residuos de centavos
    v_iva := round((v_int + d.interes_fijo_periodo) * d.iva_sobre_interes, 2);
    v_tot := v_cap + v_int + d.interes_fijo_periodo + v_iva + d.seguro_estimado;

    insert into amortizacion (user_id, deuda_id, numero, fecha, saldo_inicial, capital, interes,
                              interes_fijo, iva, seguro, pago_total, saldo_final)
    values (d.user_id, p_deuda, v_num, v_fecha, v_saldo, v_cap, v_int,
            d.interes_fijo_periodo, v_iva, d.seguro_estimado, v_tot, v_saldo - v_cap);

    v_saldo := v_saldo - v_cap; v_num := v_num + 1; v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 8. Captura: un solo llamado guarda movimiento + reparto (+ pago de deuda)
-- ---------------------------------------------------------------------
-- Ejemplo:
-- select registrar_movimiento('{
--   "fecha":"2026-10-12","tipo":"gasto","descripcion":"Hotel Chaltén",
--   "monto":10877,"moneda":"MXN","cuenta":"AMEX","rubro":"VIAJES","evento":"Patagonia 2026",
--   "asignaciones":[{"libro":"PERSONAL","pagador":"CABZ","monto":5362},
--                   {"libro":"AKELA","pagador":"CABU","monto":3096},
--                   {"libro":"PERSONAL","pagador":"HAMB","porcentaje":22.24}]}');
-- Sin "asignaciones" en gasto/ingreso: 100% PERSONAL / CABZ.
-- Acepta ids (cuenta_id, rubro_id…) o códigos/nombres (cuenta, rubro…).
create or replace function registrar_movimiento(p jsonb) returns uuid
language plpgsql as $$
declare
  v_uid uuid := crm_owner();
  v_id uuid; v_tipo tipo_movimiento := (p->>'tipo')::tipo_movimiento;
  v_monto numeric(14,2) := (p->>'monto')::numeric;
  v_cuenta uuid; v_destino uuid; v_rubro uuid; v_evento uuid; v_contra uuid;
  a jsonb; v_asig jsonb := p->'asignaciones';
  v_libro uuid; v_pag uuid; v_m numeric(14,2); v_acum numeric(14,2) := 0;
  v_i int := 0; v_total int; v_amort uuid;
begin
  v_cuenta  := coalesce((p->>'cuenta_id')::uuid,
               (select id from cuentas where user_id = v_uid and nombre = p->>'cuenta'));
  v_destino := coalesce((p->>'cuenta_destino_id')::uuid,
               (select id from cuentas where user_id = v_uid and nombre = p->>'cuenta_destino'));
  v_rubro   := coalesce((p->>'rubro_id')::uuid,
               (select id from rubros where user_id = v_uid and codigo = p->>'rubro'));
  v_evento  := coalesce((p->>'evento_id')::uuid,
               (select id from eventos where user_id = v_uid and nombre = p->>'evento'));
  v_contra  := coalesce((p->>'contraparte_id')::uuid,
               (select id from pagadores where user_id = v_uid and codigo = p->>'contraparte'));

  if v_cuenta is null then raise exception 'Cuenta no encontrada: %', coalesce(p->>'cuenta', p->>'cuenta_id'); end if;
  if p ? 'rubro' and v_rubro is null then raise exception 'Rubro no encontrado: %', p->>'rubro'; end if;
  if p ? 'cuenta_destino' and v_destino is null then raise exception 'Cuenta destino no encontrada: %', p->>'cuenta_destino'; end if;

  insert into movimientos (user_id, fecha, tipo, estado, descripcion, monto, moneda, monto_cuenta,
                           cuenta_id, cuenta_destino_id, rubro_id, evento_id, contraparte_id,
                           tiene_cfdi, cfdi_uuid, notas)
  values (v_uid, (p->>'fecha')::date, v_tipo, coalesce((p->>'estado')::estado_movimiento, 'real'),
          p->>'descripcion', v_monto, coalesce(p->>'moneda','MXN'), (p->>'monto_cuenta')::numeric,
          v_cuenta, v_destino, v_rubro, v_evento, v_contra,
          coalesce((p->>'tiene_cfdi')::boolean, p ? 'cfdi_uuid'), (p->>'cfdi_uuid')::uuid, p->>'notas')
  returning id into v_id;

  if v_tipo in ('gasto','ingreso') then
    if v_asig is null or jsonb_array_length(v_asig) = 0 then
      v_asig := '[{"libro":"PERSONAL","pagador":"CABZ","porcentaje":100}]';
    end if;
    v_total := jsonb_array_length(v_asig);
    for a in select * from jsonb_array_elements(v_asig) loop
      v_i := v_i + 1;
      v_libro := coalesce((a->>'libro_id')::uuid,
                 (select id from libros where user_id = v_uid and codigo = a->>'libro'));
      v_pag   := coalesce((a->>'pagador_id')::uuid,
                 (select id from pagadores where user_id = v_uid and codigo = a->>'pagador'));
      if v_libro is null then raise exception 'Libro no encontrado: %', a->>'libro'; end if;
      if v_pag   is null then raise exception 'Pagador no encontrado: %', a->>'pagador'; end if;
      if v_i = v_total and a ? 'porcentaje' then
        v_m := v_monto - v_acum;                       -- el último absorbe el redondeo
      elsif a ? 'porcentaje' then
        v_m := round(v_monto * (a->>'porcentaje')::numeric / 100, 2);
      else
        v_m := (a->>'monto')::numeric;
      end if;
      insert into asignaciones (user_id, movimiento_id, libro_id, pagador_id, monto)
      values (v_uid, v_id, v_libro, v_pag, v_m);
      v_acum := v_acum + v_m;
    end loop;
  end if;

  -- Abono a un préstamo: marca el siguiente pago proyectado como pagado.
  if v_tipo = 'abono_deuda' then
    select am.id into v_amort
      from amortizacion am join deudas d on d.id = am.deuda_id
     where d.cuenta_id = v_destino and am.estado = 'proyectado'
     order by am.numero limit 1;
    if v_amort is not null then
      update amortizacion set estado = 'pagado', movimiento_id = v_id where id = v_amort;
    end if;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 9. IBKR (fase 2: el importador replica la lógica del Panel Contable CABZ)
-- ---------------------------------------------------------------------
create table ibkr_estados_mensuales (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default crm_owner() references auth.users(id) on delete cascade,
  cuenta_id         uuid not null references cuentas(id),
  periodo           date not null check (extract(day from periodo) = 1),
  moneda_reporte    char(3) not null default 'MXN',
  nav_inicial       numeric(16,2),
  nav_final         numeric(16,2),       -- sección "Valor liquidativo / Net Asset Value"
  depositos         numeric(16,2) not null default 0,
  retiros           numeric(16,2) not null default 0,
  transferencias    numeric(16,2) not null default 0,
  dividendos        numeric(16,2) not null default 0,
  intereses         numeric(16,2) not null default 0,
  retenciones       numeric(16,2) not null default 0,
  comisiones        numeric(16,2) not null default 0,
  pnl_realizado     numeric(16,2) not null default 0,
  pnl_no_realizado  numeric(16,2),       -- saldo de cierre del mes, NO delta
  tc_mxn            numeric(12,6),
  documento_id      uuid references documentos(id),
  fuente            text not null default 'IB Activity Statement CSV',
  created_at        timestamptz not null default now(),
  unique (cuenta_id, periodo)
);

-- ---------------------------------------------------------------------
-- 10. Vistas (security_invoker: respetan RLS)
-- ---------------------------------------------------------------------
create view v_movimientos with (security_invoker = true) as
select m.*,
       c.nombre  as cuenta, cd.nombre as cuenta_destino,
       r.codigo  as rubro_codigo, r.nombre as rubro,
       coalesce(rp.codigo, r.codigo) as grupo_codigo, coalesce(rp.nombre, r.nombre) as grupo,
       e.nombre  as evento, pc.codigo as contraparte,
       tc_mxn(m.moneda, m.fecha) as tc,
       round(m.monto * tc_mxn(m.moneda, m.fecha), 2) as monto_mxn,
       date_trunc('month', m.fecha)::date as mes
from movimientos m
join cuentas c        on c.id = m.cuenta_id
left join cuentas cd  on cd.id = m.cuenta_destino_id
left join rubros r    on r.id = m.rubro_id
left join rubros rp   on rp.id = r.padre_id
left join eventos e   on e.id = m.evento_id
left join pagadores pc on pc.id = m.contraparte_id;

-- Una fila por porción de gasto/ingreso: base de todos los análisis.
create view v_asignaciones with (security_invoker = true) as
select a.id, a.movimiento_id, m.fecha, m.mes, m.tipo, m.estado, m.descripcion,
       l.codigo as libro, p.codigo as pagador, m.grupo_codigo, m.grupo, m.rubro_codigo, m.rubro, m.evento,
       m.cuenta, ct.codigo as titular_cuenta, m.tiene_cfdi,
       a.monto, m.moneda, round(a.monto * m.tc, 2) as monto_mxn
from asignaciones a
join v_movimientos m on m.id = a.movimiento_id
join libros l        on l.id = a.libro_id
join pagadores p     on p.id = a.pagador_id
join cuentas c       on c.id = m.cuenta_id
left join pagadores ct on ct.id = c.titular_id;

create view v_gasto_mensual with (security_invoker = true) as
select mes, libro, grupo_codigo, grupo, rubro_codigo, rubro,
       sum(monto_mxn) as gasto_mxn, count(*) as partidas
from v_asignaciones
where tipo = 'gasto' and estado = 'real'
group by 1,2,3,4,5,6;

create view v_presupuesto_vs_real with (security_invoker = true) as
with ppto as (
  select pr.mes, l.codigo as libro, r.codigo as rubro_codigo, r.nombre as rubro,
         sum(round(pr.monto * tc_mxn(pr.moneda, pr.mes), 2)) as presupuesto_mxn
  from presupuestos pr join libros l on l.id = pr.libro_id join rubros r on r.id = pr.rubro_id
  group by 1,2,3,4)
select coalesce(p.mes, g.mes) as mes, coalesce(p.libro, g.libro) as libro,
       coalesce(p.rubro_codigo, g.rubro_codigo) as rubro_codigo,
       coalesce(p.rubro, g.rubro) as rubro,
       coalesce(p.presupuesto_mxn, 0) as presupuesto_mxn,
       coalesce(g.gasto_mxn, 0)       as real_mxn,
       coalesce(g.gasto_mxn, 0) - coalesce(p.presupuesto_mxn, 0) as desviacion_mxn
from ppto p
full join v_gasto_mensual g
  on g.mes = p.mes and g.libro = p.libro and g.rubro_codigo = p.rubro_codigo;

-- Libro Akela en espejo: aportaciones al Fondo Akela + gastos asignados a AKELA.
create view v_libro_akela with (security_invoker = true) as
select m.fecha, m.mes, 'aportacion'::text as concepto, m.descripcion,
       coalesce(m.contraparte, 'CABZ') as quien, null::text as rubro,
       m.monto_mxn as entrada_mxn, 0::numeric as salida_mxn
from v_movimientos m
join cuentas cd on cd.id = m.cuenta_destino_id
where m.tipo = 'transferencia' and cd.tipo = 'fondo' and m.estado = 'real'
union all
select fecha, mes, 'gasto', descripcion, pagador, rubro, 0, monto_mxn
from v_asignaciones
where libro = 'AKELA' and tipo = 'gasto' and estado = 'real';

-- Quién te debe: porciones de otros pagadores que salieron de tus cuentas,
-- menos lo que te han reembolsado.
create view v_por_cobrar with (security_invoker = true) as
with cargos as (
  select pagador, sum(monto_mxn) as pagado_por_ti_mxn
  from v_asignaciones
  where tipo = 'gasto' and estado = 'real'
    and titular_cuenta = (select codigo from pagadores where es_titular limit 1)
    and pagador <> titular_cuenta
  group by 1),
reemb as (
  select contraparte as pagador, sum(monto_mxn) as reembolsado_mxn
  from v_movimientos where tipo = 'reembolso' and estado = 'real'
  group by 1)
select coalesce(c.pagador, r.pagador) as pagador,
       coalesce(c.pagado_por_ti_mxn, 0) as pagado_por_ti_mxn,
       coalesce(r.reembolsado_mxn, 0)   as reembolsado_mxn,
       coalesce(c.pagado_por_ti_mxn, 0) - coalesce(r.reembolsado_mxn, 0) as saldo_por_cobrar_mxn
from cargos c full join reemb r on r.pagador = c.pagador;

-- Saldos de cheques, tarjetas, fondos (préstamos van en v_deudas).
create view v_saldo_cuentas with (security_invoker = true) as
with mov as (
  -- salida de la cuenta origen (o entrada, en ingreso/reembolso)
  select m.cuenta_id as cuenta_id,
         case when m.tipo in ('ingreso','reembolso') then 1 else -1 end *
         case when m.moneda = c.moneda then m.monto
              when m.monto_cuenta is not null then m.monto_cuenta
              else round(m.monto * tc_mxn(m.moneda, m.fecha) / tc_mxn(c.moneda, m.fecha), 2) end as importe
  from movimientos m join cuentas c on c.id = m.cuenta_id
  where m.estado = 'real'
  union all
  -- entrada a la cuenta destino
  select m.cuenta_destino_id,
         case when m.moneda = c.moneda then m.monto
              else round(m.monto * tc_mxn(m.moneda, m.fecha) / tc_mxn(c.moneda, m.fecha), 2) end
  from movimientos m join cuentas c on c.id = m.cuenta_destino_id
  where m.estado = 'real' and m.cuenta_destino_id is not null)
select c.id, c.nombre, c.tipo, c.moneda,
       c.saldo_inicial + coalesce(sum(mov.importe), 0) as saldo,
       round((c.saldo_inicial + coalesce(sum(mov.importe), 0)) * tc_mxn(c.moneda, current_date), 2) as saldo_mxn
from cuentas c left join mov on mov.cuenta_id = c.id
where c.tipo <> 'prestamo' and c.activa
group by c.id;

create view v_deudas with (security_invoker = true) as
select d.id as deuda_id, c.nombre as deuda, c.moneda, d.metodo, d.tasa_anual, d.tasa_es_implicita,
       coalesce((select saldo_final from amortizacion
                  where deuda_id = d.id and estado = 'pagado' order by numero desc limit 1),
                d.saldo_referencia) as saldo_actual,
       px.fecha as proximo_pago_fecha, px.pago_total as proximo_pago_monto,
       (select count(*) from amortizacion where deuda_id = d.id and estado = 'proyectado') as pagos_restantes,
       (select max(fecha) from amortizacion where deuda_id = d.id) as fecha_liquidacion,
       (select sum(interes + interes_fijo + iva + seguro) from amortizacion
         where deuda_id = d.id and estado = 'proyectado') as costo_financiero_restante,
       d.fecha_fin_contractual
from deudas d
join cuentas c on c.id = d.cuenta_id
left join lateral (select fecha, pago_total from amortizacion
                    where deuda_id = d.id and estado = 'proyectado'
                    order by numero limit 1) px on true;

-- ---------------------------------------------------------------------
-- 11. Seguridad: RLS dueño único en todas las tablas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['libros','pagadores','rubros','eventos','cuentas','documentos','cfdi',
                           'movimientos','asignaciones','presupuestos','deudas','amortizacion',
                           'ibkr_estados_mensuales']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owner_all on %I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table app_config enable row level security;
create policy owner_read on app_config for select to authenticated using (owner_id = auth.uid());

alter table tipos_cambio enable row level security;
create policy tc_read  on tipos_cambio for select to authenticated using (true);
create policy tc_write on tipos_cambio for all to authenticated
  using (auth.uid() = (select owner_id from app_config where id))
  with check (auth.uid() = (select owner_id from app_config where id));

-- Storage: bucket privado; cada archivo bajo la carpeta <user_id>/
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false)
      on conflict (id) do nothing;
    execute $p$create policy docs_owner on storage.objects for all to authenticated
      using (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
