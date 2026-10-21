-- 36: real Akela 2026 = tu tabla (ene–oct). Requiere 33.
--     1) crea los subrubros Akela que faltan; 2) liga cada línea del plan a su subrubro principal y consolida en él los
--     movimientos 2026 del libro AKELA que estaban en subrubros equivalentes (p. ej. Patagonia → Vacaciones);
--     3) carga la diferencia (tabla − registrado) como gastos reales pagados por CABZ desde Cheques, día 1 de cada mes,
--     notas 'ajuste_akela:2026' (se pueden borrar con una sola sentencia). Solo líneas CABZ no transferencia, ene–oct.
--     Ojo: si Cheques tiene fecha_saldo_inicial anterior al 1 del mes ajustado, esos ajustes sí mueven el saldo.
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__IMPUESTOS_PAPAS', 'Impuestos papás', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Impuestos papás');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__LIQUIDACION_JOSE_LUIS', 'Liquidación José Luis', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Liquidación José Luis');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__MUEBLES_PLANTAS_Y_BARANDAL', 'Muebles, plantas y barandal', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Muebles, plantas y barandal');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__PIPA', 'Pipa', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Pipa');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__GAS', 'Gas', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Gas');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__INTERNET', 'Internet', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Internet');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__CELULAR', 'Celular', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Celular');
insert into rubros (codigo, nombre, naturaleza, padre_id) select 'AKELA__LIMPIEZA', 'Limpieza', 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela') where not exists (select 1 from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Limpieza');
-- 2) subrubro principal por línea + consolidación de movimientos
create temp table t_mapa as select * from (values
  ('Pago CABU', 'Pago CABU', 1),
  ('IMSS', 'IMSS', 1),
  ('IMSS', 'IMSS CABU', 2),
  ('CP José Luis', 'Honorarios CP', 1),
  ('CP José Luis', 'Contador papá', 2),
  ('Liquidación José Luis', 'Liquidación José Luis', 1),
  ('Seguro Mercedes', 'Seguro Mercedes Benz', 1),
  ('Seguro Mercedes', 'Auto Mercedes', 2),
  ('Seguro GMM', 'Seguro GMM', 1),
  ('Seguro GMM', 'Seguro GMM papás', 2),
  ('Colonoscopia', 'Colonoscopia', 1),
  ('Estudios Chupitos', 'Estudios Chupitos', 1),
  ('Estudios Chupitos', 'Salud papás', 2),
  ('Ortopedia CABU', 'Ortosur CABU', 1),
  ('Vacaciones', 'Vacaciones', 1),
  ('Vacaciones', 'Viajes México - Huatulco', 2),
  ('Vacaciones', 'Patagonia 2026 Vuelo', 3),
  ('Vacaciones', 'Hotel Buenos Aires III', 4),
  ('Vacaciones', 'Comidas argentina', 5),
  ('Vacaciones', 'Lavanderia', 6),
  ('Vacaciones', 'Transporte', 7),
  ('Restaurantes', 'Restaurant Chupitos', 1),
  ('Impuestos', 'Impuestos papás', 1),
  ('Gastos casa', 'Gastos casa', 1),
  ('Gastos casa', 'Home Depot', 2),
  ('Muebles, plantas y barandal', 'Muebles, plantas y barandal', 1),
  ('Predial', 'Predial', 1),
  ('Tenencia Mercedes y frenos', 'Tenencia y verificación', 1),
  ('Tenencia Mercedes y frenos', 'Frenos Mercedes', 2),
  ('Tenencia Mercedes y frenos', 'Llanas Mercedes', 3),
  ('Tenencia Mercedes y frenos', 'Servicio Mercedes', 4),
  ('CFE', 'CFE', 1),
  ('CFE', 'CFE 1', 2),
  ('CFE', 'CFE 2', 3),
  ('CFE', 'Servicios casa Oaxaca', 4),
  ('Agua', 'Agua', 1),
  ('Agua', 'Servicios Casa', 2),
  ('Pipa', 'Pipa', 1),
  ('Gas', 'Gas', 1),
  ('Internet', 'Internet', 1),
  ('Celular', 'Celular', 1),
  ('Comida del perro', 'Comida del perro', 1),
  ('Súper CABZ', 'Super Sabinos', 1),
  ('Súper', 'Súper', 1),
  ('Gasolina', 'Gasolina', 1),
  ('Limpieza', 'Personal doméstico', 1),
  ('Limpieza', 'Limpieza', 2),
  ('Depósito GT (papá)', 'Pago a papá', 1),
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 1),
  ('Depósito Chupitos (mamá)', 'Pago MPZB', 2),
  ('Depósito al Fondo Akela', 'Depósito al Fondo', 1)
) as v(linea, rubro, orden);
with akela as (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela'),
sub as (select r.id, r.nombre from rubros r, akela where r.user_id = crm_owner() and r.padre_id = akela.id),
primario as (select m.linea, s.id as rubro_id from t_mapa m join sub s on s.nombre = m.rubro where m.orden = 1)
update plan_akela p set rubro_id = pr.rubro_id from primario pr where p.user_id = crm_owner() and p.anio in (2026, 2027) and p.linea = pr.linea;
with akela as (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela'),
sub as (select r.id, r.nombre from rubros r, akela where r.user_id = crm_owner() and r.padre_id = akela.id),
primario as (select m.linea, s.id as rubro_id from t_mapa m join sub s on s.nombre = m.rubro where m.orden = 1),
equiv as (select s.id as viejo, pr.rubro_id as nuevo from t_mapa m join sub s on s.nombre = m.rubro join primario pr on pr.linea = m.linea where m.orden > 1)
update movimientos mv set rubro_id = e.nuevo from equiv e
where mv.user_id = crm_owner() and mv.rubro_id = e.viejo and mv.fecha between '2026-01-01' and '2026-12-31'
  and exists (select 1 from asignaciones a join libros l on l.id = a.libro_id where a.movimiento_id = mv.id and l.codigo = 'AKELA');
-- 3) ajustes
delete from movimientos where user_id = crm_owner() and notas = 'ajuste_akela:2026';
with akela as (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela'),
sub as (select r.id, r.nombre from rubros r, akela where r.user_id = crm_owner() and r.padre_id = akela.id),
primario as (select m.linea, s.id as rubro_id from t_mapa m join sub s on s.nombre = m.rubro where m.orden = 1),
registrado as (
  select p.linea, extract(month from mv.fecha)::int as mes, sum(a.monto) as real
  from asignaciones a join movimientos mv on mv.id = a.movimiento_id
  join libros l on l.id = a.libro_id and l.codigo = 'AKELA'
  join primario p on p.rubro_id = mv.rubro_id
  where mv.tipo = 'gasto' and mv.estado = 'real' and mv.fecha between '2026-01-01' and '2026-12-31'
  group by 1,2),
dif as (
  select p.linea, p.mes, p.monto - coalesce(r.real, 0) as faltante, pr.rubro_id
  from plan_akela p join pagadores pg on pg.id = p.pagador_id
  left join registrado r on r.linea = p.linea and r.mes = p.mes
  join primario pr on pr.linea = p.linea
  where p.user_id = crm_owner() and p.anio = 2026 and p.mes <= 10 and pg.codigo = 'CABZ' and not p.es_transferencia)
select count(registrar_movimiento(jsonb_build_object('fecha', make_date(2026, mes, 1), 'tipo', 'gasto', 'estado', 'real', 'rubro_id', rubro_id, 'cuenta', 'Cheques',
         'monto', faltante, 'moneda', 'MXN', 'descripcion', 'Ajuste real Akela 2026: ' || linea, 'notas', 'ajuste_akela:2026',
         'asignaciones', '[{"libro":"AKELA","pagador":"CABZ","porcentaje":100}]'::jsonb))) as ajustes_cargados
from dif where faltante > 0;
select regexp_replace(descripcion, '^Ajuste real Akela 2026: ', '') as linea, sum(monto) as ajustado from movimientos where user_id = crm_owner() and notas = 'ajuste_akela:2026' group by 1 order by 2 desc;
select sum(real) as real_crm_2026_ene_oct from v_akela_real_vs_plan where anio = 2026 and mes <= 10;
drop table t_mapa;
