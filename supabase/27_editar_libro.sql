-- 27: editar_movimiento acepta 'libro' y 'pagador' (códigos): cambia el reparto completo del movimiento. Requiere 19.
create or replace function editar_movimiento(p jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_old numeric; v_new numeric; v_n int; v_lib uuid; v_pag uuid;
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
    select count(*) into v_n from asignaciones where movimiento_id = v_id;
    if v_n > 0 then
      update asignaciones set monto = round(monto * v_new / v_old, 2) where movimiento_id = v_id;
      update asignaciones a set monto = monto + (v_new - (select sum(monto) from asignaciones where movimiento_id = v_id))
      where a.id = (select id from asignaciones where movimiento_id = v_id order by monto desc, id limit 1);
    end if;
  end if;

  -- libro / pagador: aplica a todas las asignaciones del movimiento
  if nullif(p->>'libro', '') is not null then
    select id into v_lib from libros where user_id = auth.uid() and codigo = p->>'libro';
    if v_lib is null then raise exception 'Libro no encontrado: %', p->>'libro'; end if;
    update asignaciones set libro_id = v_lib where movimiento_id = v_id;
  end if;
  if nullif(p->>'pagador', '') is not null then
    select id into v_pag from pagadores where user_id = auth.uid() and codigo = p->>'pagador';
    if v_pag is null then raise exception 'Pagador no encontrado: %', p->>'pagador'; end if;
    update asignaciones set pagador_id = v_pag where movimiento_id = v_id;
  end if;
  return v_id;
end $$;
