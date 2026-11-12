import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { ensureFolder, listFolder, uploadFile, deleteFile, walk } from "@/lib/drive";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Respaldo a Drive: ZIP con todas las tablas (JSON) cada corrida + copia incremental de los archivos del bucket documentos.
 *  GET = cron de Vercel (Bearer CRON_SECRET, service role). POST = botón con tu sesión (sólo tus filas, por RLS). */
const TABLAS = ["app_config", "accesos", "anios", "pagadores", "libros", "rubros", "cuentas", "eventos", "movimientos", "asignaciones", "presupuestos", "plan_akela", "deudas", "amortizacion", "saldos_cuenta", "tipos_cambio",
  "cfdi", "cfdi_reglas", "documentos", "drive_sync", "ingresos_detalle", "ibkr_estados_mensuales", "importaciones", "ajustes_fiscales", "obligaciones_fiscales", "megalodon_secciones", "megalodon_activos", "metas_ahorro"];
const CONSERVAR = 8;          // respaldos semanales que se guardan
const MAX_ARCHIVOS = 30;      // archivos de storage copiados por corrida (incremental)

function carpetaRaiz() {
  const raw = (process.env.DRIVE_BACKUP_FOLDER_ID ?? process.env.DRIVE_FACTURAS_FOLDER_ID ?? "").trim().replace(/^["']|["']$/g, "");
  const id = raw.match(/folders\/([-\w]{20,})/)?.[1] ?? raw.match(/[-\w]{20,}/)?.[0];
  if (!id) throw new Error("DRIVE_BACKUP_FOLDER_ID (o DRIVE_FACTURAS_FOLDER_ID) no configurado.");
  return { id, propia: !!process.env.DRIVE_BACKUP_FOLDER_ID };
}

async function respaldar(db: SupabaseClient) {
  const raiz = carpetaRaiz();
  const root = raiz.propia ? raiz.id : await ensureFolder(raiz.id, "zz_backup_crm");   // dentro de facturas: el sync lo ignora (patrón backup)
  const hoy = new Date().toISOString().slice(0, 10);
  const zip = new JSZip(); const resumen: Record<string, number> = {}; const errores: string[] = [];
  for (const t of TABLAS) {
    const filas: unknown[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db.from(t).select("*").range(desde, desde + 999);
      if (error) { errores.push(`${t}: ${error.message}`); break; }
      filas.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
    }
    resumen[t] = filas.length; zip.file(`${t}.json`, JSON.stringify(filas));
  }
  // listado del bucket (rutas y tamaños) para saber qué había
  const objetos = await listarBucket(db);
  zip.file("_storage_index.json", JSON.stringify(objetos));
  zip.file("_manifest.json", JSON.stringify({ fecha: hoy, tablas: resumen, storage: objetos.length, errores, nota: "Restaurar: correr 01..NN_*.sql en un proyecto nuevo y cargar cada JSON con upsert (user_id del dueño nuevo)." }, null, 2));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const nombre = `crm_${hoy}.zip`;
  const existentes = (await listFolder(root)).filter((f) => /^crm_\d{4}-\d{2}-\d{2}\.zip$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of existentes.filter((f) => f.name === nombre)) await deleteFile(e.id);   // misma fecha: reemplaza
  const id = await uploadFile(root, nombre, bytes, "application/zip");
  const viejos = existentes.filter((f) => f.name !== nombre).slice(0, Math.max(0, existentes.filter((f) => f.name !== nombre).length - (CONSERVAR - 1)));
  for (const v of viejos) await deleteFile(v.id);

  // storage incremental: carpeta "storage/", archivos con la ruta aplanada (a__b__c.pdf)
  const stFolder = await ensureFolder(root, "storage");
  const ya = new Set((await walk(stFolder)).map((x) => x.file.name));
  let copiados = 0, bytesCop = 0;
  for (const o of objetos) {
    if (copiados >= MAX_ARCHIVOS) break;
    const plano = o.path.replace(/\//g, "__");
    if (ya.has(plano)) continue;
    const { data, error } = await db.storage.from("documentos").download(o.path);
    if (error || !data) { errores.push(`storage ${o.path}: ${error?.message ?? "vacío"}`); continue; }
    const buf = new Uint8Array(await data.arrayBuffer());
    await uploadFile(stFolder, plano, buf, data.type || "application/octet-stream"); copiados++; bytesCop += buf.length;
  }
  return { fecha: hoy, zip: nombre, zip_bytes: bytes.length, drive_id: id, tablas: resumen, storage_total: objetos.length, storage_copiados: copiados, storage_pendientes: Math.max(0, objetos.filter((o) => !ya.has(o.path.replace(/\//g, "__"))).length - copiados), storage_bytes: bytesCop, conservados: CONSERVAR, errores };
}

async function listarBucket(db: SupabaseClient, prefix = ""): Promise<{ path: string; size: number; updated: string | null }[]> {
  const out: { path: string; size: number; updated: string | null }[] = [];
  const { data, error } = await db.storage.from("documentos").list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const it of data) {
    const p = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.id === null || !it.metadata) out.push(...(await listarBucket(db, p)));   // carpeta
    else out.push({ path: p, size: Number((it.metadata as { size?: number }).size ?? 0), updated: it.updated_at ?? null });
  }
  return out;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!srk) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado." }, { status: 503 });
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, srk, { auth: { persistSession: false } });
  try { return NextResponse.json(await respaldar(admin)); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  try { return NextResponse.json(await respaldar(supabase)); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
