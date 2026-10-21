-- 38: gasolina 2027 = 2,000/mes; línea informativa "Aportación Luis Miguel" (HAMB, va al fondo; monto por definir, edítalo en Editar plan). Requiere 35/36.
update plan_akela set monto = 2000 where user_id = crm_owner() and anio = 2027 and linea = 'Gasolina';
delete from plan_akela where user_id = crm_owner() and anio = 2027 and linea = 'Aportación Luis Miguel';
insert into plan_akela (anio, linea, pagador_id, es_transferencia, categoria, rubro_id, mes, monto)
select 2027, 'Aportación Luis Miguel', (select id from pagadores where user_id = crm_owner() and codigo = 'HAMB'), true, 'Akela',
       (select r.id from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Depósito al Fondo' limit 1), m, 0
from generate_series(1, 12) m;
select sum(monto) as pago_yo_2027 from v_plan_akela where anio = 2027 and pagador = 'CABZ';
