-- =====================================================================
-- CRM CABZ · 02_seed_catalogos.sql
-- Antes de correrlo: crea tu usuario en Authentication > Users (uno solo).
-- Sin datos sensibles: se puede versionar.
-- =====================================================================

-- Dueño = el único usuario de Auth.
do $$
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Debe existir exactamente 1 usuario en auth.users (hay %)', (select count(*) from auth.users);
  end if;
  insert into app_config (owner_id) select id from auth.users
    on conflict (id) do update set owner_id = excluded.owner_id;
end $$;

insert into libros (codigo, nombre, descripcion) values
  ('PERSONAL','Personal / Hogar','Tus gastos y los de tu casa'),
  ('AKELA',   'Familia Akela',   'Patrimonio y gastos de tus papás; espejo de Akela Administradora Flujos'),
  ('BIOONGO', 'Bioongo',         'Asesoría en inversiones'),
  ('PERIPLO', 'Periplo',         'SOFOM'),
  ('CORDADA', 'Cordada',         'Gastos reembolsables del trabajo');

insert into pagadores (codigo, nombre, es_titular) values
  ('CABZ','Claudio', true),
  ('CABU','Papá',    false),
  ('MPZB','Mamá',    false),
  ('HAMB','Hamburguesa (hermano)', false);

insert into cuentas (nombre, tipo, moneda, titular_id, es_medio_pago, institucion) values
  ('AMEX',          'tarjeta_credito','MXN',(select id from pagadores where codigo='CABZ'), true,'American Express'),
  ('TDC Santander', 'tarjeta_credito','MXN',(select id from pagadores where codigo='CABZ'), true,'Santander'),
  ('Cheques',       'cheques',        'MXN',(select id from pagadores where codigo='CABZ'), true, null),
  ('Fondo Akela',   'fondo',          'MXN',(select id from pagadores where codigo='CABU'), false,null);

-- Rubros de gasto (nivel 1) -------------------------------------------
insert into rubros (codigo, nombre, naturaleza, orden) values
  ('VIVIENDA','Vivienda','gasto',10),
  ('SERVICIOS','Servicios','gasto',20),
  ('SUPER','Supermercado','gasto',30),
  ('RESTAURANTES','Restaurantes y delivery','gasto',40),
  ('TRANSPORTE','Transporte','gasto',50),
  ('SALUD','Salud','gasto',60),
  ('SEGUROS','Seguros','gasto',70),
  ('HOGAR','Hogar','gasto',80),
  ('DEPORTE','Deporte','gasto',90),
  ('ENTRETENIMIENTO','Entretenimiento y suscripciones','gasto',100),
  ('VIAJES','Viajes','gasto',110),
  ('PROFESIONAL','Profesional','gasto',120),
  ('IMPUESTOS','Impuestos','gasto',130),
  ('COMISIONES','Comisiones bancarias','gasto',140);

-- Subrubros (nivel 2) --------------------------------------------------
insert into rubros (codigo, nombre, naturaleza, padre_id, orden)
select v.codigo, v.nombre, 'gasto', p.id, v.orden
from (values
  ('VIVIENDA','RENTA','Renta',1),('VIVIENDA','PREDIAL','Predial',2),('VIVIENDA','MANTENIMIENTO','Mantenimiento y obra',3),
  ('SERVICIOS','LUZ','Luz (CFE)',1),('SERVICIOS','AGUA','Agua',2),('SERVICIOS','GAS','Gas',3),
  ('SERVICIOS','INTERNET','Internet / TV',4),('SERVICIOS','CELULAR','Celular',5),
  ('SUPER','SUPERMERCADO','Súper',1),('SUPER','CAFE','Café',2),
  ('RESTAURANTES','RESTAURANTE','Restaurante',1),('RESTAURANTES','DELIVERY','Delivery',2),
  ('TRANSPORTE','GASOLINA','Gasolina',1),('TRANSPORTE','CASETAS','Casetas',2),
  ('TRANSPORTE','SEGURO_AUTO','Seguro de auto',3),('TRANSPORTE','SERVICIO_AUTO','Servicio y refacciones',4),
  ('TRANSPORTE','TENENCIA','Tenencia y verificación',5),('TRANSPORTE','UBER','Uber / taxi',6),
  ('SALUD','MEDICOS','Médicos',1),('SALUD','FARMACIA','Farmacia',2),('SALUD','ESTUDIOS','Estudios',3),
  ('SALUD','SUPLEMENTOS','Suplementos',4),('SALUD','CUIDADO_PERSONAL','Cuidado personal',5),
  ('SEGUROS','SEGURO_GMM','Gastos médicos mayores',1),('SEGUROS','SEGURO_VIDA','Vida',2),
  ('HOGAR','PERSONAL_DOMESTICO','Personal doméstico',1),('HOGAR','MUEBLES','Muebles y equipamiento',2),
  ('HOGAR','TINTORERIA','Tintorería / lavandería',3),('HOGAR','ROPA','Ropa',4),
  ('DEPORTE','GYM','Gym',1),('DEPORTE','NATACION','Natación',2),
  ('ENTRETENIMIENTO','STREAMING','Streaming y apps',1),('ENTRETENIMIENTO','MUSICA','Música y audio',2),
  ('ENTRETENIMIENTO','EVENTOS','Eventos y celebraciones',3),
  ('VIAJES','VUELOS','Vuelos',1),('VIAJES','HOSPEDAJE','Hospedaje',2),('VIAJES','COMIDAS_VIAJE','Comidas en viaje',3),
  ('VIAJES','TRANSPORTE_VIAJE','Transporte en viaje',4),('VIAJES','ACTIVIDADES','Excursiones y actividades',5),
  ('PROFESIONAL','CONTADOR','Contador',1),('PROFESIONAL','SOFTWARE','Software y nube',2),
  ('PROFESIONAL','CUOTAS_REG','Cuotas regulatorias (CNBV, SCPADI)',3),('PROFESIONAL','CERTIFICACIONES','Certificaciones (CFA)',4),
  ('PROFESIONAL','OFICINA','Oficina y renta de espacio',5),('PROFESIONAL','HONORARIOS_TERCEROS','Honorarios de terceros',6),
  ('IMPUESTOS','ISR','ISR',1),('IMPUESTOS','IMSS','IMSS / Infonavit',2),
  ('COMISIONES','COMISION_TDC','Comisiones de tarjeta',1)
) as v(padre, codigo, nombre, orden)
join rubros p on p.codigo = v.padre;

-- Rubros de ingreso ----------------------------------------------------
insert into rubros (codigo, nombre, naturaleza, orden) values
  ('ING_SUELDO','Sueldo','ingreso',200),
  ('ING_BONO','Bonos','ingreso',210),
  ('ING_HONORARIOS','Honorarios','ingreso',220),
  ('ING_RENDIMIENTOS','Rendimientos e intereses','ingreso',230),
  ('ING_VENTA_ACTIVOS','Venta de activos','ingreso',240),
  ('ING_OTROS','Otros ingresos','ingreso',250);

insert into eventos (nombre, fecha_inicio, fecha_fin) values
  ('Patagonia 2026', '2026-03-01', '2026-05-31'),
  ('Roma 2026',      '2026-09-12', '2026-09-21'),
  ('Dolomitas',      null, null);
