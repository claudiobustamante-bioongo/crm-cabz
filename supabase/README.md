# Base de datos · cómo se mantiene y cómo se recrea

**Archivos numerados `NN_*.sql`** son la fuente de verdad: se corren en orden en el SQL Editor de Supabase
(cada uno es idempotente o dice cuándo requiere al anterior). Los que terminan en `b` o están en `.gitignore`
(`03_seed_personal`, `05_carga_2026`, `08_revolut_usd`, `11_rfc`, `39b`, `40b`, `42b`) traen datos personales:
no están en git, viven en el Project de Claude y en el respaldo.

**`migrations/`** se genera con `node scripts/migraciones.mjs` (copia ordenada de los no personales con el nombre
que espera la CLI). Sirve para `supabase db push` en un proyecto nuevo o para `supabase db diff` al revisar.
No se edita a mano.

## Recrear el CRM desde cero
1. Proyecto nuevo en Supabase → `supabase link` → `supabase db push` (o correr `NN_*.sql` a mano en orden).
   Los `alter type … add value` (29, 46) van en su propia transacción.
2. Bucket `documentos` (privado) en Storage.
3. Crear tu usuario (Authentication) y poner su uuid en `app_config.owner_id` (lo hace `03_seed_personal` o a mano).
4. Datos: último `crm_AAAA-MM-DD.zip` de Drive → `node scripts/restaurar.mjs crm_….zip`
   con `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `OWNER_ID` en el entorno.
5. Vercel: variables de entorno (ver `.env.example`) y deploy.

## Respaldo
`/api/backup` corre cada domingo (cron de Vercel) y desde Analíticas → Salud financiera → «respaldar ahora»:
ZIP con todas las tablas en JSON (conserva 8) + copia incremental del bucket en `storage/`.
Carpeta: `DRIVE_BACKUP_FOLDER_ID` o, si no existe, `zz_backup_crm` dentro de la carpeta de facturas.
