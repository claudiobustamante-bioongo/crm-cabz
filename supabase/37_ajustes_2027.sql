-- 37: ajustes 2027 — contador 950 todos los meses; restaurantes 15,000 repartidos en 12 (1,250/mes). Requiere 35.
update plan_akela set monto = 950 where user_id = crm_owner() and anio = 2027 and linea = 'Contador';
update plan_akela set monto = 1250 where user_id = crm_owner() and anio = 2027 and linea = 'Restaurantes';
select linea, sum(monto) as anual from plan_akela where user_id = crm_owner() and anio = 2027 and linea in ('Contador', 'Restaurantes') group by 1;
select sum(monto) as pago_yo_2027 from v_plan_akela where anio = 2027 and pagador = 'CABZ';
