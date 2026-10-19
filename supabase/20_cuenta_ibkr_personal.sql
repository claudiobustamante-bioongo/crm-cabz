-- 20: alta de una cuenta IBKR adicional (login personal, fuera de la maestra).
--     Cambia el número de cuenta U######## por el tuyo antes de correrlo. El nombre debe contener ese número:
--     así la casan los CSV y el Flex.
insert into cuentas (nombre, tipo, moneda, titular_id, institucion, notas, es_medio_pago, activa)
values ('IBKR Personal U00000000', 'inversion', 'MXN', (select id from pagadores where codigo = 'CABZ'), 'Interactive Brokers', 'Cuenta personal, fuera de la maestra', false, true)
on conflict do nothing;
select id, nombre, tipo, activa from cuentas where nombre like 'IBKR%' order by nombre;
