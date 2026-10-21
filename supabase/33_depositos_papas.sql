-- 33: depósitos de Claudio a mamá (Chupitos) y papá (GT) en 2026 (abr, jun, jul, ago, sep), depósito al fondo de febrero,
--     y categoría (rubro) por línea. Requiere 32.
alter table plan_akela add column if not exists categoria text;
delete from plan_akela where user_id = crm_owner() and anio = 2026 and linea in ('Depósito Chupitos (mamá)', 'Depósito GT (papá)', 'Depósito al Fondo Akela');
insert into plan_akela (anio, linea, rubro_id, pagador_id, es_transferencia, mes, monto)
select 2026, v.linea,
       (select r.id from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = v.rubro limit 1),
       (select id from pagadores where user_id = crm_owner() and codigo = 'CABZ'), false, v.mes, v.monto
from (values
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 1, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 2, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 3, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 4, 16500),
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 5, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 6, 15000), ('Depósito Chupitos (mamá)', 'Pago a mamá', 7, 16500), ('Depósito Chupitos (mamá)', 'Pago a mamá', 8, 15000),
  ('Depósito Chupitos (mamá)', 'Pago a mamá', 9, 16500), ('Depósito Chupitos (mamá)', 'Pago a mamá', 10, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 11, 0), ('Depósito Chupitos (mamá)', 'Pago a mamá', 12, 0),
  ('Depósito GT (papá)', 'Pago a papá', 1, 0), ('Depósito GT (papá)', 'Pago a papá', 2, 0), ('Depósito GT (papá)', 'Pago a papá', 3, 0), ('Depósito GT (papá)', 'Pago a papá', 4, 14600),
  ('Depósito GT (papá)', 'Pago a papá', 5, 0), ('Depósito GT (papá)', 'Pago a papá', 6, 14104), ('Depósito GT (papá)', 'Pago a papá', 7, 14605), ('Depósito GT (papá)', 'Pago a papá', 8, 14000),
  ('Depósito GT (papá)', 'Pago a papá', 9, 10000), ('Depósito GT (papá)', 'Pago a papá', 10, 0), ('Depósito GT (papá)', 'Pago a papá', 11, 0), ('Depósito GT (papá)', 'Pago a papá', 12, 0)
) as v(linea, rubro, mes, monto);
-- Febrero: depósito al Fondo Akela (25,182). Transferencia: cuenta como pagado por ti, no como gasto.
insert into plan_akela (anio, linea, rubro_id, pagador_id, es_transferencia, categoria, mes, monto)
select 2026, 'Depósito al Fondo Akela',
       (select r.id from rubros r join rubros p on p.id = r.padre_id where r.user_id = crm_owner() and p.nombre = 'Akela' and r.nombre = 'Depósito al Fondo' limit 1),
       (select id from pagadores where user_id = crm_owner() and codigo = 'CABZ'), true, 'Akela', m, case when m = 2 then 25182 else 0 end
from generate_series(1, 12) m;
-- y el movimiento real de la aportación, si no hay ninguna registrada en febrero 2026
select registrar_movimiento('{"fecha":"2026-02-28","tipo":"transferencia","cuenta":"Cheques","cuenta_destino":"Fondo Akela","monto":25182,"moneda":"MXN","contraparte":"CABZ","descripcion":"Depósito al Fondo Akela feb-2026"}'::jsonb)
where not exists (select 1 from v_libro_akela where concepto = 'aportacion' and quien = 'CABZ' and fecha between '2026-02-01' and '2026-02-28');
-- categoría (rubro) de cada línea 2026
update plan_akela set categoria = case
  when linea in ('Pago CABU','IMSS') or linea like 'Depósito%' then 'Akela'
  when linea in ('Víctor Porras') then 'Abogado'
  when linea in ('CP José Luis','Liquidación José Luis','Impuestos') then 'Impuestos'
  when linea in ('Seguro Mercedes','Tenencia Mercedes y frenos','Gasolina') then 'Transporte'
  when linea in ('Seguro GMM','Colonoscopia','Estudios Chupitos','Ortopedia CABU') then 'Salud'
  when linea in ('Vacaciones') then 'Viajes'
  when linea in ('Restaurantes') then 'Restaurantes / Delivery'
  when linea in ('Gastos casa','Muebles, plantas y barandal','Predial','Súper CABZ','Internet','Celular','Comida del perro','Súper','Limpieza') then 'Hogar'
  when linea in ('CFE','Agua','Pipa','Gas') then 'Utilities'
  else categoria end
 where user_id = crm_owner() and anio = 2026;
-- "Pago CABU" ya estaba ligado a Pago a papá; para no duplicar el real, se queda sin subrubro (es lo que papá gasta de su dinero).
update plan_akela set rubro_id = null where user_id = crm_owner() and anio = 2026 and linea = 'Pago CABU';
select categoria, linea, sum(monto) as anual from plan_akela where user_id = crm_owner() and anio = 2026 group by 1,2 order by 1,2;
