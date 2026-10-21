-- 29: acceso del contador (solo lectura: Contabilidad y Facturación). Requiere 28.
--     Alta: en Supabase → Authentication → Users → "Invite user" con su correo; luego:
--     insert into accesos (user_id, rol, nombre) select id, 'contador', 'Nombre del contador' from auth.users where email = 'correo@dominio.com';

-- lo que ya existía: cfdi, ibkr_estados_mensuales, documentos (cfdi/estado_cuenta), ingresos_detalle, catálogos.
-- faltaba:
drop policy if exists contador_config on app_config;
create policy contador_config on app_config for select to authenticated using (mi_rol() is not null);
drop policy if exists contador_mov_ingresos on movimientos;
create policy contador_mov_ingresos on movimientos for select to authenticated
  using (mi_rol() = 'contador' and tipo in ('ingreso'));
drop policy if exists contador_asig_ingresos on asignaciones;
create policy contador_asig_ingresos on asignaciones for select to authenticated
  using (mi_rol() = 'contador' and exists (select 1 from movimientos m where m.id = asignaciones.movimiento_id and m.tipo = 'ingreso'));
drop policy if exists contador_ajustes on ajustes_fiscales;
create policy contador_ajustes on ajustes_fiscales for select to authenticated using (mi_rol() = 'contador');
drop policy if exists contador_obligaciones on obligaciones_fiscales;
create policy contador_obligaciones on obligaciones_fiscales for select to authenticated using (mi_rol() = 'contador');
drop policy if exists contador_drive on drive_sync;
create policy contador_drive on drive_sync for select to authenticated using (mi_rol() = 'contador');
drop policy if exists contador_saldos on saldos_cuenta;
create policy contador_saldos on saldos_cuenta for select to authenticated using (mi_rol() = 'contador');
-- documentos: también las extranjeras (categoria 'comprobante')
drop policy if exists contador_docs on documentos;
create policy contador_docs on documentos for select to authenticated
  using (mi_rol() = 'contador' and categoria in ('cfdi','estado_cuenta','comprobante'));

-- Storage: el contador lee los archivos del dueño (XML/PDF)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists docs_contador on storage.objects';
    execute $p$create policy docs_contador on storage.objects for select to authenticated
      using (bucket_id = 'documentos' and mi_rol() = 'contador'
             and (storage.foldername(name))[1] = (select owner_id::text from app_config limit 1))$p$;
  end if;
end $$;

-- quién soy (para la app)
select mi_rol() as rol;
