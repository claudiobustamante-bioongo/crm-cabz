import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { walk, download, ensureFolder, moveFile, type DriveFile } from "@/lib/drive";
import { parseCfdiServer } from "@/lib/cfdi-server";

export const maxDuration = 60;              // plan Hobby de Vercel
const LOTE = 40;                            // archivos nuevos por corrida; el resto en la siguiente

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
/** Mes a partir de la ruta "02 - Facturas Mex/2026/09-Septiembre" o de la fecha de creación. */
function mesDe(path: string, f: DriveFile): string {
  const y = path.match(/(20\d{2})/)?.[1];
  const m = path.toLowerCase().match(/(\d{1,2})\s*-\s*([a-záéíóú]+)/);
  if (y && m) { const mm = MESES[m[2].normalize("NFD").replace(/[̀-ͯ]/g, "")] ?? +m[1]; if (mm) return `${y}-${String(mm).padStart(2, "0")}-01`; }
  return f.createdTime.slice(0, 7) + "-01";
}

/**
 * GET (cron de Vercel, header Authorization: Bearer CRON_SECRET) o POST (botón, con tu sesión).
 * Recorre la carpeta DRIVE_FACTURAS_FOLDER_ID, procesa lo nuevo y lo guarda.
 */
async function sync(db: SupabaseClient, userId: string, rfc: string | null) {
  // acepta el ID solo o la URL completa de la carpeta; quita espacios y comillas
  const raw = (process.env.DRIVE_FACTURAS_FOLDER_ID ?? "").trim().replace(/^["']|["']$/g, "");
  const root = raw.match(/folders\/([-\w]{20,})/)?.[1] ?? raw.match(/[-\w]{20,}/)?.[0];
  if (!root) throw new Error(`DRIVE_FACTURAS_FOLDER_ID inválido (${raw.length} caracteres). Debe ser 1uf4az0pUKUCxHe-WuSg8Vw_VYacZWfyZ.`);
  const items = await walk(root, "", (n) => /consolidad/i.test(n));
  const { data: done } = await db.from("drive_sync").select("drive_id").eq("user_id", userId);
  const hechos = new Set((done ?? []).map((d) => d.drive_id));
  const { data: uuids } = await db.from("cfdi").select("uuid").eq("user_id", userId);
  const existentes = new Set((uuids ?? []).map((u) => u.uuid));
  const esXml = (f: DriveFile) => /\.xml$/i.test(f.name) || f.mimeType === "text/xml" || f.mimeType === "application/xml";
  // todos los XML antes que cualquier PDF, para que un PDF nunca se procese antes que su XML (aunque caigan en lotes distintos)
  const pendientesTotal = items.filter((i) => !hechos.has(i.file.id) && !i.file.shortcutDetails).sort((a, b) => Number(esXml(b.file)) - Number(esXml(a.file)));
  const nuevos = pendientesTotal.slice(0, LOTE);
  const res = { cfdi: 0, pdf: 0, extranjeras: 0, omitidos: 0, errores: 0, duplicados: 0 };
  const log = (f: DriveFile, path: string, tipo: string, extra: Record<string, unknown> = {}) =>
    db.from("drive_sync").upsert({ drive_id: f.id, user_id: userId, nombre: f.name, mime: f.mimeType, carpeta: path, link_drive: f.webViewLink ?? null, tipo, ...extra });

  // 1) XML primero (para que los PDF encuentren su CFDI)
  const xmls = nuevos.filter((i) => /\.xml$/i.test(i.file.name) || i.file.mimeType === "text/xml" || i.file.mimeType === "application/xml");
  const stemDe = (n: string) => n.replace(/\.(xml|pdf)$/i, "").toLowerCase();
  const uuidPorStem = new Map<string, string>();
  for (const { file, path } of xmls) {
    try {
      if (Number(file.size ?? 0) === 0) { await log(file, path, "omitido", { detalle: "archivo vacío" }); res.omitidos++; continue; }
      const xml = Buffer.from(await download(file.id)).toString("utf8");
      const p = parseCfdiServer(xml, rfc);
      uuidPorStem.set(stemDe(file.name), p.uuid);
      if (existentes.has(p.uuid)) {   // ya estaba (subida a mano): solo le pone el link de Drive si no tenía
        if (file.webViewLink) await db.from("cfdi").update({ link_drive: file.webViewLink }).eq("uuid", p.uuid).is("link_drive", null);
        await log(file, path, "omitido", { detalle: "UUID ya registrado", cfdi_uuid: p.uuid, mes: p.fecha.slice(0, 7) + "-01" }); res.duplicados++; continue;
      }
      const base = `${userId}/cfdi/${p.fecha.slice(0, 4)}/${p.uuid}`;
      const up = await db.storage.from("documentos").upload(`${base}.xml`, Buffer.from(xml, "utf8"), { contentType: "text/xml", upsert: true });
      if (up.error) throw up.error;
      const { data: dx, error: e2 } = await db.from("documentos").upsert({ user_id: userId, nombre: file.name, storage_path: `${base}.xml`, mime: "text/xml", tamano_bytes: Number(file.size ?? 0), categoria: "cfdi", fecha_documento: p.fecha }, { onConflict: "storage_path" }).select("id").single();
      if (e2) throw e2;
      const { error: e3 } = await db.from("cfdi").insert({
        user_id: userId, uuid: p.uuid, tipo: p.tipo, tipo_comprobante: p.tipo_comprobante, fecha: p.fecha, serie: p.serie, folio: p.folio,
        emisor_rfc: p.emisor_rfc, emisor_nombre: p.emisor_nombre, receptor_rfc: p.receptor_rfc, receptor_nombre: p.receptor_nombre,
        concepto: p.concepto, conceptos: p.conceptos, uso_cfdi: p.uso_cfdi, subtotal: p.subtotal, descuento: p.descuento, iva: p.iva, ret_isr: p.ret_isr, ret_iva: p.ret_iva, total: p.total,
        moneda: p.moneda, tc: p.tc, forma_pago: p.forma_pago, metodo_pago: p.metodo_pago, xml_documento_id: dx.id, link_drive: file.webViewLink ?? null,
        estado: p.tipo === "recibida" ? "nueva" : "sin_gasto", confianza: "alta (XML)", notas: `Drive: ${path}`,
      });
      if (e3) throw e3;
      existentes.add(p.uuid);
      await log(file, path, "cfdi", { cfdi_uuid: p.uuid, documento_id: dx.id, mes: p.fecha.slice(0, 7) + "-01" });
      res.cfdi++;
    } catch (e) { await log(file, path, "error", { detalle: (e as Error).message.slice(0, 300) }); res.errores++; }
  }

  // 2) PDF: anexo de un CFDI (mismo nombre base o UUID en el nombre) o factura extranjera
  const pdfs = nuevos.filter((i) => /\.pdf$/i.test(i.file.name) || i.file.mimeType === "application/pdf");
  for (const { file, path } of pdfs) {
    try {
      const stem = stemDe(file.name);
      const uuidEnNombre = file.name.toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
      let uuid = uuidPorStem.get(stem) ?? (uuidEnNombre && existentes.has(uuidEnNombre) ? uuidEnNombre : undefined);
      if (!uuid) { const { data } = await db.from("drive_sync").select("cfdi_uuid").eq("user_id", userId).eq("tipo", "cfdi").ilike("nombre", `${stem}.xml`).maybeSingle(); uuid = data?.cfdi_uuid ?? undefined; }
      const bytes = Buffer.from(await download(file.id));
      if (uuid) {
        const { data: c } = await db.from("cfdi").select("fecha,pdf_documento_id").eq("uuid", uuid).single();
        if (c && !c.pdf_documento_id) {
          const base = `${userId}/cfdi/${String(c.fecha).slice(0, 4)}/${uuid}`;
          const up = await db.storage.from("documentos").upload(`${base}.pdf`, bytes, { contentType: "application/pdf", upsert: true });
          if (up.error) throw up.error;
          const { data: dp } = await db.from("documentos").upsert({ user_id: userId, nombre: file.name, storage_path: `${base}.pdf`, mime: "application/pdf", tamano_bytes: bytes.length, categoria: "cfdi", fecha_documento: c.fecha }, { onConflict: "storage_path" }).select("id").single();
          await db.from("cfdi").update({ pdf_documento_id: dp?.id ?? null }).eq("uuid", uuid);
          if (file.webViewLink) await db.from("cfdi").update({ link_drive: file.webViewLink }).eq("uuid", uuid).is("link_drive", null);
          await log(file, path, "pdf_cfdi", { cfdi_uuid: uuid, documento_id: dp?.id ?? null, mes: String(c.fecha).slice(0, 7) + "-01" });
        } else await log(file, path, "omitido", { detalle: "el CFDI ya tiene PDF", cfdi_uuid: uuid });
        res.pdf++;
      } else if (!/extranjer/i.test(path)) {   // PDF suelto en carpeta de mexicanas: no es extranjera, falta su XML
        await log(file, path, "omitido", { detalle: "PDF sin XML (carpeta de mexicanas)", mes: mesDe(path, file) });
        res.omitidos++;
      } else {
        const mes = mesDe(path, file);
        const safe = file.name.replace(/[^\w.\-]+/g, "_");
        const sp = `${userId}/extranjeras/${mes.slice(0, 7)}/${file.id}_${safe}`;
        const up = await db.storage.from("documentos").upload(sp, bytes, { contentType: "application/pdf", upsert: true });
        if (up.error) throw up.error;
        const { data: d } = await db.from("documentos").upsert({ user_id: userId, nombre: file.name, storage_path: sp, mime: "application/pdf", tamano_bytes: bytes.length, categoria: "comprobante", fecha_documento: mes, notas: `Factura extranjera · Drive: ${path}` }, { onConflict: "storage_path" }).select("id").single();
        await log(file, path, "extranjera", { documento_id: d?.id ?? null, mes });
        res.extranjeras++;
      }
    } catch (e) { await log(file, path, "error", { detalle: (e as Error).message.slice(0, 300) }); res.errores++; }
  }

  // 3) lo demás (hojas, imágenes…) se marca como omitido para no revisarlo cada vez
  for (const { file, path } of nuevos.filter((i) => !xmls.includes(i) && !pdfs.includes(i))) { await log(file, path, "omitido", { detalle: file.mimeType }); res.omitidos++; }

  // 4) ordenar en Drive: cada archivo ya clasificado va a Mex|Extranjeras / año / MM-Mes (si la cuenta de servicio es Editor)
  const ord = await ordenar(db, userId, root, items);
  return { ...res, ...ord, revisados: items.length, nuevos: nuevos.length, pendientes: pendientesTotal.length - nuevos.length };
}

const NOMBRE_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
async function ordenar(db: SupabaseClient, userId: string, root: string, items: { file: DriveFile; path: string }[]) {
  const out = { movidos: 0, sin_permiso: 0 };
  const { data: regs } = await db.from("drive_sync").select("drive_id,tipo,mes").eq("user_id", userId).in("tipo", ["cfdi", "pdf_cfdi", "extranjera"]).not("mes", "is", null);
  if (!regs?.length) return out;
  const porId = new Map(items.map((i) => [i.file.id, i]));
  const carpetas = new Map<string, string>();   // "mex/2026/02" → folderId
  let mexId: string | null = null, extId: string | null = null;
  for (const r of regs) {
    if (out.movidos >= 60) break;   // cabe en los 60 s; el resto en la siguiente corrida
    const it = porId.get(r.drive_id); if (!it) continue;
    const anio = String(r.mes).slice(0, 4), mm = String(r.mes).slice(5, 7);
    const esExt = r.tipo === "extranjera";
    const destinoPath = `${esExt ? "ext" : "mex"}/${anio}/${mm}`;
    // ya está en su lugar si su ruta termina en "<anio>/<mm>-<Mes>" y en la rama correcta
    const enRama = esExt ? /extranjer/i.test(it.path) : /mex/i.test(it.path) && !/extranjer/i.test(it.path);
    if (enRama && new RegExp(`${anio}/${mm}\\s*-`).test(it.path)) continue;
    try {
      if (!carpetas.has(destinoPath)) {
        if (esExt) extId ??= await ensureFolder(root, "01 - Facturas Extranjeras", /extranjer/i);
        else mexId ??= await ensureFolder(root, "02 - Facturas Mex", /mex/i);
        const anioId = await ensureFolder(esExt ? extId! : mexId!, anio);
        carpetas.set(destinoPath, await ensureFolder(anioId, `${mm}-${NOMBRE_MES[+mm - 1]}`, new RegExp(`^${mm}\\s*-`)));
      }
      await moveFile(it.file.id, carpetas.get(destinoPath)!, it.file.parents ?? []);
      await db.from("drive_sync").update({ carpeta: `${esExt ? "01 - Facturas Extranjeras" : "02 - Facturas Mex"}/${anio}/${mm}-${NOMBRE_MES[+mm - 1]}` }).eq("drive_id", r.drive_id).eq("user_id", userId);
      out.movidos++;
    } catch (e) {
      if (/403|insufficient|permission/i.test((e as Error).message)) { out.sin_permiso++; if (out.sin_permiso > 2) break; }   // sin permiso de escritura: no insistir
      else throw e;
    }
  }
  return out;
}

export async function GET(req: Request) {
  // cron de Vercel: usa service_role (solo servidor) y actúa como el dueño
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!srk) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurado." }, { status: 503 });
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, srk, { auth: { persistSession: false } });
  const { data: cfg } = await admin.from("app_config").select("owner_id,rfc_propio").single();
  if (!cfg) return NextResponse.json({ error: "app_config vacío." }, { status: 500 });
  try { return NextResponse.json(await sync(admin, cfg.owner_id, cfg.rfc_propio)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const { data: cfg } = await supabase.from("app_config").select("rfc_propio").maybeSingle();
  try { return NextResponse.json(await sync(supabase, user.id, cfg?.rfc_propio ?? null)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
