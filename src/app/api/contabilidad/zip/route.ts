import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** GET /api/contabilidad/zip?anio=2026[&mes=3] → ZIP con XML y PDF de los CFDI del periodo, en carpetas por mes y tipo. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const u = new URL(req.url);
  const anio = Number(u.searchParams.get("anio")) || new Date().getFullYear();
  const mes = Number(u.searchParams.get("mes")) || 0;
  const desde = mes ? `${anio}-${String(mes).padStart(2, "0")}-01` : `${anio}-01-01`;
  const hasta = mes ? new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10) : `${anio}-12-31`;
  const { data: cfdis, error } = await supabase.from("v_cfdi").select("uuid,tipo,tipo_comprobante,fecha,emisor_rfc,emisor_nombre,receptor_rfc,total,xml_path,pdf_path,xml_nombre,pdf_nombre").gte("fecha", desde).lte("fecha", hasta).order("fecha").range(0, 4999);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cfdis?.length) return NextResponse.json({ error: "No hay CFDI en ese periodo." }, { status: 404 });

  const zip = new JSZip();
  const safe = (s: string) => s.replace(/[^\w.\-]+/g, "_").slice(0, 60);
  const lineas = ["fecha,tipo,comprobante,uuid,emisor_rfc,emisor,receptor_rfc,total,xml,pdf"];
  let n = 0;
  for (const c of cfdis) {
    const carpeta = `${c.fecha.slice(0, 7)}/${c.tipo}`;
    const base = `${c.fecha}_${safe(c.emisor_nombre ?? c.emisor_rfc)}_${c.uuid.slice(0, 8).toUpperCase()}`;
    const bajar = async (path: string | null, ext: string) => {
      if (!path) return "";
      const { data } = await supabase.storage.from("documentos").download(path);
      if (!data) return "";
      zip.file(`${carpeta}/${base}.${ext}`, Buffer.from(await data.arrayBuffer())); n++;
      return `${base}.${ext}`;
    };
    const [x, p] = await Promise.all([bajar(c.xml_path, "xml"), bajar(c.pdf_path, "pdf")]);
    lineas.push([c.fecha, c.tipo, c.tipo_comprobante, c.uuid.toUpperCase(), c.emisor_rfc, `"${(c.emisor_nombre ?? "").replace(/"/g, '""')}"`, c.receptor_rfc, c.total, x, p].join(","));
  }
  zip.file("indice.csv", "﻿" + lineas.join("\n"));
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const nombre = mes ? `CFDI_${anio}-${String(mes).padStart(2, "0")}.zip` : `CFDI_${anio}.zip`;
  return new NextResponse(new Blob([buf as BlobPart]), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${nombre}"`, "X-Archivos": String(n) } });
}
