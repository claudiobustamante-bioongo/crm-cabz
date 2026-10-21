-- 36: Akela definitivo (estructura). Requiere 33 y 34.
--     1) Los subrubros que colgaban de "Akela" pasan bajo los rubros generales (Salud, Viajes, Hogar, Transporte, Utilities,
--        Impuestos, Restaurantes / Delivery). Si ya existía un subrubro con el mismo nombre ahí, se fusiona (movimientos y plan
--        pasan al existente; el de Akela se desactiva). En "Akela" quedan: Pago a papá, Pago a mamá, Depósito al Fondo, Pago CABU/MPZB, IMSS.
--     2) plan_akela: real_conciliado (real capturado a mano, 2026) y anual (presupuesto anual sin mensualizar, guardado en mes 1).
--     3) 2026: cada línea ligada a su subrubro; real_conciliado = tu tabla (ene–oct).
-- 1) reestructura de rubros ---------------------------------------------------------------------
create temp table t_dest as select * from (values
  ('Seguro GMM','Salud'),('Seguro GMM papás','Salud'),('Estudios Chupitos','Salud'),('Salud papás','Salud'),('Colonoscopia','Salud'),('Ortosur CABU','Salud'),
  ('Vacaciones','Viajes'),('Viajes México - Huatulco','Viajes'),('Patagonia 2026 Vuelo','Viajes'),('Hotel Buenos Aires III','Viajes'),('Comidas argentina','Viajes'),('Lavanderia','Viajes'),('Transporte','Viajes'),
  ('Seguro Mercedes Benz','Transporte'),('Auto Mercedes','Transporte'),('Tenencia y verificación','Transporte'),('Frenos Mercedes','Transporte'),('Llanas Mercedes','Transporte'),('Servicio Mercedes','Transporte'),('Gasolina','Transporte'),
  ('CFE','Utilities'),('CFE 1','Utilities'),('CFE 2','Utilities'),('Servicios casa Oaxaca','Utilities'),('Servicios Casa','Utilities'),('Agua','Utilities'),
  ('Gastos casa','Hogar'),('Home Depot','Hogar'),('Predial','Hogar'),('Súper','Hogar'),('Super Sabinos','Hogar'),('Personal doméstico','Hogar'),('Comida del perro','Hogar'),('Pantalones Papa','Hogar'),
  ('Honorarios CP','Impuestos'),('Contador papá','Impuestos'),
  ('Restaurant Chupitos','Restaurantes / Delivery')) as v(sub, padre);
create temp table t_mov as
select r.id as viejo, r.nombre, d.padre,
       (select p.id from rubros p where p.user_id = crm_owner() and p.padre_id is null and p.nombre = d.padre) as padre_id,
       (select x.id from rubros x join rubros p on p.id = x.padre_id where x.user_id = crm_owner() and p.nombre = d.padre and x.nombre = r.nombre and x.id <> r.id limit 1) as existente
from rubros r join rubros a on a.id = r.padre_id and a.nombre = 'Akela' and a.padre_id is null
join t_dest d on d.sub = r.nombre
where r.user_id = crm_owner();
-- fusiona con el existente
update movimientos m set rubro_id = t.existente from t_mov t where m.user_id = crm_owner() and m.rubro_id = t.viejo and t.existente is not null;
update plan_akela p set rubro_id = t.existente from t_mov t where p.user_id = crm_owner() and p.rubro_id = t.viejo and t.existente is not null;
update cfdi c set rubro_id = t.existente from t_mov t where c.user_id = crm_owner() and c.rubro_id = t.viejo and t.existente is not null;
update rubros r set activo = false, nombre = r.nombre || ' (fusionado)' from t_mov t where r.id = t.viejo and t.existente is not null;
-- re-cuelga los demás
update rubros r set padre_id = t.padre_id, codigo = replace(r.codigo, 'AKELA__', upper(regexp_replace(translate(t.padre, 'áéíóúÁÉÍÓÚñÑ/ ', 'aeiouAEIOUnN__'), '[^A-Za-z0-9_]', '', 'g')) || '__')
from t_mov t where r.id = t.viejo and t.existente is null and t.padre_id is not null
  and not exists (select 1 from rubros z where z.user_id = crm_owner() and z.id <> r.id and z.codigo = replace(r.codigo, 'AKELA__', upper(regexp_replace(translate(t.padre, 'áéíóúÁÉÍÓÚñÑ/ ', 'aeiouAEIOUnN__'), '[^A-Za-z0-9_]', '', 'g')) || '__'));
update rubros r set padre_id = t.padre_id from t_mov t where r.id = t.viejo and t.existente is null and t.padre_id is not null and r.padre_id <> t.padre_id;  -- por si chocó el código
-- subrubros nuevos que necesita el plan
insert into rubros (codigo, nombre, naturaleza, padre_id)
select v.cod, v.nom, 'gasto', (select id from rubros where user_id = crm_owner() and padre_id is null and nombre = v.padre)
from (values ('IMPUESTOS__IMPUESTOS_PAPAS','Impuestos papás','Impuestos'), ('IMPUESTOS__LIQUIDACION_JOSE_LUIS','Liquidación José Luis','Impuestos'),
             ('HOGAR__MUEBLES_PLANTAS_BARANDAL','Muebles, plantas y barandal','Hogar'), ('UTILITIES__PIPA','Pipa','Utilities'),
             ('HOGAR__LIMPIEZA_PAPAS','Limpieza (papás)','Hogar'), ('AKELA__VICTOR_PORRAS','Víctor Porras','Akela'), ('HOGAR__MEJORAS','Mejoras','Hogar')) as v(cod, nom, padre)
where not exists (select 1 from rubros r where r.user_id = crm_owner() and r.codigo = v.cod);
-- 2) columnas ----------------------------------------------------------------------------------
alter table plan_akela add column if not exists real_conciliado numeric(14,2);
alter table plan_akela add column if not exists anual boolean not null default false;
create or replace view v_plan_akela with (security_invoker = true) as
select p.id, p.anio, p.linea, p.rubro_id, pg.codigo as pagador, p.es_transferencia, p.mes, p.monto, p.notas,
       coalesce(pa.nombre, p.categoria) as categoria, r.nombre as subrubro, p.real_conciliado, p.anual
from plan_akela p join pagadores pg on pg.id = p.pagador_id
left join rubros r on r.id = p.rubro_id left join rubros pa on pa.id = r.padre_id;
grant select on v_plan_akela to authenticated;
-- 3) 2026: subrubro por línea + real conciliado -------------------------------------------------
create temp table t_lin as select * from (values
  ('Pago CABU','Akela','Pago CABU'), ('IMSS','Akela','IMSS'), ('Víctor Porras','Akela','Víctor Porras'),
  ('Depósito GT (papá)','Akela','Pago a papá'), ('Depósito Chupitos (mamá)','Akela','Pago a mamá'), ('Depósito al Fondo Akela','Akela','Depósito al Fondo'),
  ('CP José Luis','Impuestos','Honorarios CP'), ('Liquidación José Luis','Impuestos','Liquidación José Luis'), ('Impuestos','Impuestos','Impuestos papás'),
  ('Seguro Mercedes','Transporte','Seguro Mercedes Benz'), ('Tenencia Mercedes y frenos','Transporte','Tenencia y verificación'), ('Gasolina','Transporte','Gasolina'),
  ('Seguro GMM','Salud','Seguro GMM'), ('Colonoscopia','Salud','Colonoscopia'), ('Estudios Chupitos','Salud','Estudios Chupitos'), ('Ortopedia CABU','Salud','Ortosur CABU'),
  ('Vacaciones','Viajes','Vacaciones'), ('Restaurantes','Restaurantes / Delivery','Restaurantes'),
  ('Gastos casa','Hogar','Gastos casa'), ('Muebles, plantas y barandal','Hogar','Muebles, plantas y barandal'), ('Predial','Hogar','Predial'),
  ('Súper CABZ','Hogar','Super Sabinos'), ('Súper','Hogar','Súper'), ('Comida del perro','Hogar','Comida del perro'), ('Limpieza','Hogar','Limpieza (papás)'),
  ('CFE','Utilities','CFE'), ('Agua','Utilities','Agua'), ('Pipa','Utilities','Pipa'), ('Gas','Utilities','Gas'), ('Internet','Utilities','Internet'), ('Celular','Utilities','Celular')) as v(linea, padre, sub);
update plan_akela p set rubro_id = r.id, categoria = t.padre
from t_lin t join rubros pa on pa.user_id = crm_owner() and pa.padre_id is null and pa.nombre = t.padre
join rubros r on r.padre_id = pa.id and r.nombre = t.sub and r.activo
where p.user_id = crm_owner() and p.anio = 2026 and p.linea = t.linea;
update plan_akela set real_conciliado = monto where user_id = crm_owner() and anio = 2026 and mes <= 10;
update plan_akela set real_conciliado = null where user_id = crm_owner() and anio = 2026 and mes > 10;
-- resumen
select linea, categoria, subrubro, pagador, sum(monto) as plan, sum(real_conciliado) as real_ene_oct from v_plan_akela where anio = 2026 group by 1,2,3,4 order by 2,1;
select linea from v_plan_akela where anio = 2026 and rubro_id is null group by 1;
drop table t_dest; drop table t_mov; drop table t_lin;
