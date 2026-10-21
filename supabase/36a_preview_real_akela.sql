-- 36a: VISTA PREVIA (no escribe nada). Real 2026 ene–oct según tu tabla (= plan 2026) vs lo registrado en el CRM, por línea.
--      Columna "faltante" = lo que 36 cargaría como movimiento de ajuste. Negativo = el CRM tiene más que tu tabla (no se carga; revísalo).
create temp table t_dif as
with mapa(linea, rubro, orden) as (values
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
),
akela as (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = 'Akela'),
sub as (select r.id, r.nombre from rubros r, akela where r.user_id = crm_owner() and r.padre_id = akela.id),
primario as (select m.linea, s.id as rubro_id from mapa m join sub s on s.nombre = m.rubro where m.orden = 1),
registrado as (   -- real 2026 ya en el CRM, por línea y mes, vía cualquiera de los subrubros mapeados
  select m.linea, extract(month from mv.fecha)::int as mes, sum(a.monto) as real
  from asignaciones a join movimientos mv on mv.id = a.movimiento_id
  join libros l on l.id = a.libro_id and l.codigo = 'AKELA'
  join sub s on s.id = mv.rubro_id join mapa m on m.rubro = s.nombre
  where mv.tipo = 'gasto' and mv.estado = 'real' and mv.fecha between '2026-01-01' and '2026-12-31'
  group by 1,2),
plan as (
  select p.linea, p.mes, p.monto as plan, pg.codigo as pagador, p.es_transferencia
  from plan_akela p join pagadores pg on pg.id = p.pagador_id
  where p.user_id = crm_owner() and p.anio = 2026 and p.mes <= 10),
dif as (
  select p.linea, p.mes, p.pagador, p.es_transferencia, p.plan, coalesce(r.real, 0) as registrado, p.plan - coalesce(r.real, 0) as faltante, pr.rubro_id
  from plan p left join registrado r on r.linea = p.linea and r.mes = p.mes left join primario pr on pr.linea = p.linea)
select * from dif;
select linea, pagador, sum(plan) as excel, sum(registrado) as en_crm, sum(faltante) as faltante,
       string_agg(case when faltante <> 0 then to_char(mes, 'FM00') || ':' || faltante::int end, ' ' order by mes) as por_mes,
       case when rubro_id is null then '⚠ sin subrubro' end as nota
from t_dif where not es_transferencia group by 1,2,rubro_id order by 5 desc;
select 'TOTAL CABZ (lo que pagaste)' as concepto, sum(plan) as excel, sum(registrado) as en_crm, sum(faltante) as faltante from t_dif where pagador = 'CABZ' and not es_transferencia;
drop table t_dif;
