-- 19: edición en línea de movimientos y desligar factura, en una sola transacción
--     (las asignaciones se reescalan al nuevo monto para que el reparto siga cuadrando).

create or replace function editar_movimiento(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_old numeric; v_new numeric; v_n int;
begin
  select monto into v_old from movimientos where id = v_id and user_id = auth.uid();
  if v_old is null then raise exception 'Movimiento no encontrado'; end if;
  v_new := coalesce((p->>'monto')::numeric, v_old);
  if v_new <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;

  update movimientos set
    fecha       = coalesce((p->>'fecha')::date, fecha),
    monto       = v_new,
    moneda      = coalesce(p->>'moneda', moneda),
    cuenta_id   = coalesce((p->>'cuenta_id')::uuid, cuenta_id),
    rubro_id    = coalesce((p->>'rubro_id')::uuid, rubro_id),
    descripcion = case when p ? 'descripcion' then nullif(p->>'descripcion', '') else descripcion end,
    notas       = case when p ? 'notas' then nullif(p->>'notas', '') else notas end,
    estado      = coalesce((p->>'estado')::estado_movimiento, estado)
  where id = v_id;

  if v_new <> v_old then
    -- reescala proporcionalmente; la última asignación absorbe el redondeo
    select count(*) into v_n from asignaciones where movimiento_id = v_id;
    if v_n > 0 then
      update asignaciones set monto = round(monto * v_new / v_old, 2) where movimiento_id = v_id;
      update asignaciones a set monto = monto + (v_new - (select sum(monto) from asignaciones where movimiento_id = v_id))
      where a.id = (select id from asignaciones where movimiento_id = v_id order by monto desc, id limit 1);
    end if;
  end if;
  return v_id;
end $$;

create or replace function desligar_cfdi(p_uuid uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update movimientos set cfdi_uuid = null, tiene_cfdi = false where cfdi_uuid = p_uuid and user_id = auth.uid();
  update cfdi set estado = 'nueva' where uuid = p_uuid and user_id = auth.uid();
end $$;

grant execute on function editar_movimiento(jsonb), desligar_cfdi(uuid) to authenticated;
