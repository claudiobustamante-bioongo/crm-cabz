import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCfdiServer } from "@/lib/cfdi-server";

export const maxDuration = 60;

/** POST /api/cfdi/reparsear { tipo?: "nomina" } → vuelve a leer el XML guardado de cada CFDI y corrige impuestos/conceptos. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const tipo = String(body?.tipo || "nomina");
  const { data: cfg } = await supabase.from("app_config").select("rfc_propio").maybeSingle();
  const { data: rows, error } = await supabase.from("v_cfdi").select("uuid,xml_path").eq("tipo", tipo).not("xml_path", "is", null).range(0, 999);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let ok = 0; const errs: string[] = [];
  for (const r of rows ?? []) {
    try {
      const { data } = await supabase.storage.from("documentos").download(r.xml_path!);
      if (!data) throw new Error("sin XML en Storage");
      const p = parseCfdiServer(await data.text(), cfg?.rfc_propio ?? null);
      const { error: e } = await supabase.from("cfdi").update({ subtotal: p.subtotal, descuento: p.descuento, iva: p.iva, ret_isr: p.ret_isr, ret_iva: p.ret_iva, otros_impuestos: p.otros_impuestos, total: p.total, conceptos: p.conceptos, concepto: p.concepto, tipo_comprobante: p.tipo_comprobante }).eq("uuid", r.uuid);
      if (e) throw e; ok++;
    } catch (e) { errs.push(`${r.uuid.slice(0, 8)}: ${(e as Error).message}`); }
  }
  return NextResponse.json({ ok, errores: errs });
}
