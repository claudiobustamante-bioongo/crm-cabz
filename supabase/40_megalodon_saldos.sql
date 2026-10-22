-- 40: Megalodón — liga a cuentas del CRM (saldo en vivo), datos de pólizas y sección de instrucción. Requiere 39.
alter table megalodon_activos add column if not exists cuenta_id uuid references cuentas(id) on delete set null;
alter table megalodon_activos add column if not exists seccion_clave text;        -- clave de megalodon_secciones con la instrucción
alter table megalodon_activos add column if not exists suma_asegurada text;      -- p. ej. "1,000,000 UDIS" o "160 M MXN"
alter table megalodon_activos add column if not exists prima text;               -- p. ej. "6,279.89 UDIS anual"
alter table megalodon_activos add column if not exists vigencia_inicio date;
alter table megalodon_activos add column if not exists vigencia_fin date;
alter table megalodon_activos add column if not exists cobertura text;           -- resumen de cobertura / condiciones clave
