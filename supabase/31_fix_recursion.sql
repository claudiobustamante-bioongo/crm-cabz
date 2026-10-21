-- 31: corrige "infinite recursion detected in policy for relation movimientos":
--     la política del contador sobre asignaciones consultaba movimientos (con RLS) y la de familia sobre movimientos
--     consulta asignaciones. Se rompe el ciclo con funciones security definer.
create or replace function mov_tipo(p_mov uuid) returns text
language sql stable security definer set search_path = public as $$ select tipo::text from movimientos where id = p_mov $$;
create or replace function mov_tiene_libro(p_mov uuid, p_libro text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from asignaciones a join libros l on l.id = a.libro_id where a.movimiento_id = p_mov and l.codigo = p_libro) $$;
revoke all on function mov_tipo(uuid), mov_tiene_libro(uuid, text) from public;
grant execute on function mov_tipo(uuid), mov_tiene_libro(uuid, text) to authenticated;

drop policy if exists contador_asig_ingresos on asignaciones;
create policy contador_asig_ingresos on asignaciones for select to authenticated
  using (mi_rol() = 'contador' and mov_tipo(movimiento_id) = 'ingreso');

drop policy if exists familia_mov on movimientos;
create policy familia_mov on movimientos for select to authenticated
  using (mi_rol() in ('papas','hermano') and mov_tiene_libro(id, 'AKELA'));
