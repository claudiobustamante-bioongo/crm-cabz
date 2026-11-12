// Restaura un respaldo crm_YYYY-MM-DD.zip (de /api/backup) en un proyecto Supabase.
// Requiere: esquema ya creado (migraciones) y en .env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, y OWNER_ID (uuid del dueño en el proyecto nuevo).
// Uso: node scripts/restaurar.mjs crm_2026-11-16.zip [--solo tabla1,tabla2]
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
const [, , zipPath, ...rest] = process.argv;
if (!zipPath) { console.error("Uso: node scripts/restaurar.mjs <zip> [--solo t1,t2]"); process.exit(1); }
const solo = rest.includes("--solo") ? rest[rest.indexOf("--solo") + 1].split(",") : null;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, owner = process.env.OWNER_ID;
if (!url || !key || !owner) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OWNER_ID"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const zip = await JSZip.loadAsync(readFileSync(zipPath));
const manifest = JSON.parse(await zip.file("_manifest.json").async("string"));
console.log("Respaldo del", manifest.fecha);
// orden por dependencias (padres antes que hijos); user_id se reasigna al dueño nuevo
const ORDEN = ["app_config", "anios", "pagadores", "libros", "rubros", "cuentas", "eventos", "accesos", "cfdi_reglas", "cfdi", "documentos", "movimientos", "asignaciones", "ingresos_detalle", "presupuestos", "plan_akela", "deudas", "amortizacion", "saldos_cuenta", "tipos_cambio", "drive_sync", "ibkr_estados_mensuales", "importaciones", "ajustes_fiscales", "obligaciones_fiscales", "megalodon_secciones", "megalodon_activos", "metas_ahorro"];
for (const t of ORDEN) {
  if (solo && !solo.includes(t)) continue;
  const f = zip.file(`${t}.json`); if (!f) { console.log(`· ${t}: no está en el zip`); continue; }
  const filas = JSON.parse(await f.async("string")).map((r) => ("user_id" in r ? { ...r, user_id: owner } : r)).map((r) => (t === "app_config" ? { ...r, owner_id: owner } : r)).map((r) => (t === "accesos" ? { ...r, otorgado_por: owner } : r));
  if (t === "accesos") { console.log(`· accesos: ${filas.length} omitidas (los usuarios del proyecto viejo no existen aquí; vuelve a invitar).`); continue; }
  let ok = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.from(t).upsert(filas.slice(i, i + 500));
    if (error) { console.error(`✕ ${t} lote ${i}: ${error.message}`); break; }
    ok += Math.min(500, filas.length - i);
  }
  console.log(`✓ ${t}: ${ok}/${filas.length}`);
}
console.log("Listo. Los archivos del bucket están en Drive → storage/ (ruta aplanada con __): súbelos a Storage si los necesitas.");
