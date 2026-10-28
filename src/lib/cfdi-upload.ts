"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCfdi, type CfdiParsed } from "./cfdi";

/** Sube un XML (y PDF opcional) de CFDI al storage y lo registra en `cfdi`. Si ya existía, devuelve el parseado sin duplicar. */
export async function subirCfdi(supabase: SupabaseClient, userId: string, rfcPropio: string | null, xml: File, pdf?: File | null): Promise<{ p: CfdiParsed; nuevo: boolean }> {
  const p = parseCfdi(await xml.text(), rfcPropio);
  const { data: ya } = await supabase.from("cfdi").select("uuid").eq("uuid", p.uuid).maybeSingle();
  if (ya) return { p, nuevo: false };
  const anio = p.fecha.slice(0, 4), base = `${userId}/cfdi/${anio}/${p.uuid}`;
  const { error: e1 } = await supabase.storage.from("documentos").upload(`${base}.xml`, xml, { contentType: "text/xml", upsert: true });
  if (e1) throw e1;
  const { data: dx, error: e2 } = await supabase.from("documentos").upsert({ nombre: xml.name, storage_path: `${base}.xml`, mime: "text/xml", tamano_bytes: xml.size, categoria: "cfdi", fecha_documento: p.fecha }, { onConflict: "storage_path" }).select("id").single();
  if (e2) throw e2;
  let pdfId: string | null = null;
  if (pdf) {
    const { error: e3 } = await supabase.storage.from("documentos").upload(`${base}.pdf`, pdf, { contentType: "application/pdf", upsert: true });
    if (!e3) { const { data: dp } = await supabase.from("documentos").upsert({ nombre: pdf.name, storage_path: `${base}.pdf`, mime: "application/pdf", tamano_bytes: pdf.size, categoria: "cfdi", fecha_documento: p.fecha }, { onConflict: "storage_path" }).select("id").single(); pdfId = dp?.id ?? null; }
  }
  const row = {
    uuid: p.uuid, tipo: p.tipo, tipo_comprobante: p.tipo_comprobante, fecha: p.fecha, serie: p.serie, folio: p.folio,
    emisor_rfc: p.emisor_rfc, emisor_nombre: p.emisor_nombre, receptor_rfc: p.receptor_rfc, receptor_nombre: p.receptor_nombre,
    concepto: p.concepto, conceptos: p.conceptos, uso_cfdi: p.uso_cfdi, subtotal: p.subtotal, descuento: p.descuento, iva: p.iva, ret_isr: p.ret_isr, ret_iva: p.ret_iva, otros_impuestos: p.otros_impuestos, total: p.total,
    moneda: p.moneda, tc: p.tc, forma_pago: p.forma_pago, metodo_pago: p.metodo_pago, xml_documento_id: dx.id, pdf_documento_id: pdfId,
    estado: p.tipo === "nomina" || p.tipo === "emitida" ? "sin_gasto" : "nueva",
  };
  const { error: e4 } = await supabase.from("cfdi").insert(row);
  if (e4) throw e4;
  return { p, nuevo: true };
}
