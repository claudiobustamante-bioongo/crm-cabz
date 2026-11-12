-- 46: acceso de la esposa — solo Megalodón (protocolo, inventario, saldos en vivo, pólizas, documentos). Solo lectura.
--     Alta: Supabase → Authentication → Users → "Add user" (email + contraseña, Auto Confirm) y luego:
--     insert into accesos (user_id, rol, nombre) select id, 'esposa', 'Sofía' from auth.users where email = 'correo@dominio.com';

alter type rol_acceso add value if not exists 'esposa';

-- (el alter type debe correr en una transacción distinta a su uso: corre este archivo en dos partes si el editor lo pide)
drop policy if exists esposa_secciones on megalodon_secciones;
create policy esposa_secciones on megalodon_secciones for select to authenticated using (mi_rol() = 'esposa');
drop policy if exists esposa_activos on megalodon_activos;
create policy esposa_activos on megalodon_activos for select to authenticated using (mi_rol() = 'esposa');
-- saldos en vivo: las vistas v_saldo_cuentas / v_saldo_actual son security_invoker → necesita leer movimientos y saldos_cuenta (cuentas ya lo cubre familia_catalogos_c)
drop policy if exists esposa_mov on movimientos;
create policy esposa_mov on movimientos for select to authenticated using (mi_rol() = 'esposa');
drop policy if exists esposa_saldos on saldos_cuenta;
create policy esposa_saldos on saldos_cuenta for select to authenticated using (mi_rol() = 'esposa');
drop policy if exists esposa_config on app_config;
create policy esposa_config on app_config for select to authenticated using (mi_rol() = 'esposa');
-- documentos adjuntos en Megalodón (carpeta <dueño>/megalodon/...)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists docs_esposa on storage.objects';
    execute $p$create policy docs_esposa on storage.objects for select to authenticated
      using (bucket_id = 'documentos' and mi_rol() = 'esposa'
             and (storage.foldername(name))[1] = (select owner_id::text from app_config limit 1)
             and (storage.foldername(name))[2] = 'megalodon')$p$;
  end if;
end $$;
