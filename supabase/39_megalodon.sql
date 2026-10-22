-- 39: Megalodón — protocolo en caso de fallecimiento: secciones de texto + inventario de activos/contactos/documentos.
--     Solo el dueño (RLS owner_all). Más adelante: rol 'esposa' / 'mama' con lectura.
create table if not exists megalodon_secciones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default crm_owner() references auth.users(id) on delete cascade,
  orden      int not null default 0,
  clave      text not null,
  titulo     text not null,
  contenido  text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, clave)
);
create table if not exists megalodon_activos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default crm_owner() references auth.users(id) on delete cascade,
  orden          int not null default 0,
  categoria      text not null check (categoria in ('cuenta','seguro','propiedad','empresa','contacto','documento','otro')),
  nombre         text not null,
  institucion    text,
  numero         text,            -- número de cuenta / póliza / contrato
  usuario        text,            -- usuario de acceso (nunca contraseñas)
  titular        text,
  beneficiarios  text,
  que_hacer      text,            -- instrucción concreta
  destino        text,            -- a quién va / a dónde se mueve
  contacto       text,            -- teléfono / correo / persona
  liga           text,            -- URL (Drive, portal)
  documento_path text,            -- archivo en storage documentos/<user_id>/megalodon/...
  notas          text,
  ultima_revision date default current_date,
  updated_at     timestamptz not null default now()
);
alter table megalodon_secciones enable row level security;
alter table megalodon_activos enable row level security;
drop policy if exists owner_all on megalodon_secciones; create policy owner_all on megalodon_secciones for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists owner_all on megalodon_activos;   create policy owner_all on megalodon_activos   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function megalodon_touch() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists t_meg_sec on megalodon_secciones; create trigger t_meg_sec before update on megalodon_secciones for each row execute function megalodon_touch();
drop trigger if exists t_meg_act on megalodon_activos;   create trigger t_meg_act before update on megalodon_activos   for each row execute function megalodon_touch();

-- Los datos iniciales (cuentas, contactos, secciones) van en 39b_megalodon_seed.sql (personal, fuera del repo).
