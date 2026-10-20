-- 24: honorarios 2026 según lo facturado (sin CFDI en el CRM): corrige enero–abril y agrega mayo–septiembre.
--     Bruto = subtotal facturado; IVA 16 %; retenciones de persona moral (ISR 10 %, IVA 2/3); neto = lo cobrado.
with datos(mes, bruto) as (values (1,32100.00),(2,28800.00),(3,34200.00),(4,32700.00),(5,31500.00),(6,32980.00),(7,35500.00),(8,32000.00),(9,32200.00)),
-- 1) los que ya existen: actualiza bruto, impuestos y monto
upd as (
  update ingresos_detalle d set bruto = x.bruto, iva = round(x.bruto*0.16,2), ret_isr = round(x.bruto*0.10,2), ret_iva = round(x.bruto*0.16*2/3,2)
  from movimientos m join datos x on x.mes = extract(month from m.fecha)
  where d.movimiento_id = m.id and d.tipo = 'comision' and extract(year from m.fecha) = 2026 and m.estado = 'real' and d.user_id = crm_owner()
  returning m.id, x.bruto),
upd2 as (update movimientos m set monto = round(u.bruto*(1+0.16-0.10-0.16*2/3),2) from upd u where m.id = u.id returning m.id, m.monto),
-- el reparto (asignaciones) debe seguir sumando el monto
upd3 as (update asignaciones a set monto = u.monto from upd2 u where a.movimiento_id = u.id
         and (select count(*) from asignaciones b where b.movimiento_id = u.id) = 1 returning a.id)
select (select count(*) from upd2) as actualizados, (select count(*) from upd3) as repartos;

-- 2) los meses que faltan
do $$
declare x record;
begin
  for x in select * from (values (1,32100.00),(2,28800.00),(3,34200.00),(4,32700.00),(5,31500.00),(6,32980.00),(7,35500.00),(8,32000.00),(9,32200.00)) v(mes,bruto)
    where not exists (select 1 from ingresos_detalle d join movimientos m on m.id = d.movimiento_id
                      where d.tipo = 'comision' and m.estado = 'real' and extract(year from m.fecha) = 2026 and extract(month from m.fecha) = v.mes and d.user_id = crm_owner())
  loop
    perform registrar_ingreso(jsonb_build_object('tipo','comision','fecha', make_date(2026, x.mes, 28)::text, 'bruto', x.bruto, 'persona_moral', true,
      'descripcion', 'Asesoría · ' || to_char(make_date(2026, x.mes, 1), 'TMMonth'), 'cuenta', 'Cheques', 'cliente', 'Bioongo · asesoría'));
  end loop;
end $$;

select extract(month from m.fecha)::int as mes, d.bruto, d.iva, d.ret_isr, d.ret_iva, m.monto as neto
from ingresos_detalle d join movimientos m on m.id = d.movimiento_id
where d.tipo = 'comision' and extract(year from m.fecha) = 2026 and m.estado = 'real' order by 1;
