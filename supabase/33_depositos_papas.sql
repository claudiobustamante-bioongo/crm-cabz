-- 33: depósitos de Claudio a mamá (Chupitos) y papá (GT) en 2026, como gasto CABZ ligado a Pago a mamá / Pago a papá. Requiere 32.
delete from plan_akela where user_id = crm_owner() and anio = 2026 and linea in ('Depósito Chupitos (mamá)', 'Depósito GT (papá)');
insert into plan_akela (anio, linea, rubro_id, pagador_id, es_transferencia, mes, monto)
select 2026, v.linea,
       (select r.id from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = v.rubro limit 1),
       (select id from pagadores where user_id = crm_owner() and codigo = 'CABZ'), false, v.mes, v.monto
from (values
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 1, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 2, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 3, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 4, 0),
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 5, 16500), ('Depósito Chupitos (mamá)', 'Pago a mamá', 6, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 7, 15000), ('Depósito Chupitos (mamá)', 'Pago a mamá', 8, 16500),
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 9, 15000), ('Depósito Chupitos (mamá)', 'Pago a mamá', 10, 16500), ('Depósito Chupitos (mamá)', 'Pago a mamá', 11, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 12, 0),
  ('Depósito GT (papá)', 'Pago a papá', 1, 0), ('Depósito GT (papá)', 'Pago a papá', 2, 0), ('Depósito GT (papá)', 'Pago a papá', 3, 0), ('Depósito GT (papá)', 'Pago a papá', 4, 0),
  ('Depósito GT (papá)', 'Pago a papá', 5, 14600), ('Depósito GT (papá)', 'Pago a papá', 6, 0), ('Depósito GT (papá)', 'Pago a papá', 7, 14104), ('Depósito GT (papá)', 'Pago a papá', 8, 14605),
  ('Depósito GT (papá)', 'Pago a papá', 9, 14000), ('Depósito GT (papá)', 'Pago a papá', 10, 10000), ('Depósito GT (papá)', 'Pago a papá', 11, 0), ('Depósito GT (papá)', 'Pago a papá', 12, 0)
) as v(linea, rubro, mes, monto);
-- "Pago CABU" ya estaba ligado a Pago a papá; para no duplicar el real, se queda sin subrubro (es lo que papá gasta de su dinero).
update plan_akela set rubro_id = null where user_id = crm_owner() and anio = 2026 and linea = 'Pago CABU';
select linea, sum(monto) as anual from plan_akela where user_id = crm_owner() and anio = 2026 and linea like 'Depósito%' group by 1;
