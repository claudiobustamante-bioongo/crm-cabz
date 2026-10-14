# CRM CABZ

CRM personal (Edición Fable): gastos, ingresos, inversiones e impuestos, facturación CFDI y Akela.
Next.js 15 + Supabase (Postgres, RLS, Storage) + Vercel.

## Correr
1. `cp .env.example .env.local` y pon la URL y la publishable/anon key del proyecto Supabase.
2. `npm install && npm run dev` → http://localhost:3000 (login con tu usuario de Supabase Auth).

## Base de datos (SQL Editor de Supabase, en orden)
`supabase/01_schema.sql` → `02_seed_catalogos.sql` → `03_seed_personal.sql`* → `04_migracion_v2.sql` → `05_carga_2026.sql`*

\* archivos con datos personales: no se versionan (`.gitignore`).

## Pruebas locales del SQL
`test/00_stub_supabase.sql` simula `auth.users`, `auth.uid()` y los grants de Supabase sobre un Postgres local.
