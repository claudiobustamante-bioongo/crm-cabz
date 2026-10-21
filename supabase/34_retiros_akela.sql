-- 34: retiros del Fondo Akela (fondo → cuenta propia) como tercer concepto del libro Akela, y carga del retiro de enero 2026.
create or replace view v_libro_akela with (security_invoker = true) as
select m.fecha, m.mes, 'aportacion'::text as concepto, m.descripcion,
       coalesce(m.contraparte, 'CABZ') as quien, null::text as rubro,
       m.monto_mxn as entrada_mxn, 0::numeric as salida_mxn
from v_movimientos m
join cuentas cd on cd.id = m.cuenta_destino_id
where m.tipo = 'transferencia' and cd.tipo = 'fondo' and m.estado = 'real'
union all
select m.fecha, m.mes, 'retiro', m.descripcion,
       coalesce(m.contraparte, (select p.codigo from pagadores p where p.id = cd.titular_id), 'CABZ'), null,
       0, m.monto_mxn
from v_movimientos m
join cuentas co on co.id = m.cuenta_id
left join cuentas cd on cd.id = m.cuenta_destino_id
where m.tipo = 'transferencia' and co.tipo = 'fondo' and (cd.id is null or cd.tipo <> 'fondo') and m.estado = 'real'
union all
select fecha, mes, 'gasto', descripcion, pagador, rubro, 0, monto_mxn
from v_asignaciones
where libro = 'AKELA' and tipo = 'gasto' and estado = 'real';
grant select on v_libro_akela to authenticated;

-- Retiro enero 2026: 583,000 del Fondo Akela a Cheques (reposición de gastos pagados por CABZ)
delete from movimientos where user_id = crm_owner() and tipo = 'transferencia' and descripcion = 'Retiro Fondo Akela 2026 (reposición gastos CABZ)';
select registrar_movimiento('{"fecha":"2026-01-31","tipo":"transferencia","cuenta":"Fondo Akela","cuenta_destino":"Cheques","monto":583000,"moneda":"MXN","contraparte":"CABZ","descripcion":"Retiro Fondo Akela 2026 (reposición gastos CABZ)"}'::jsonb);
select concepto, quien, sum(entrada_mxn) as entradas, sum(salida_mxn) as salidas from v_libro_akela where fecha >= '2026-01-01' group by 1,2 order by 1,2;
