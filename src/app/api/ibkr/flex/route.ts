import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchFlex, parseFlex, FlexError } from "@/lib/flex";

export const maxDuration = 60;

/**
 * POST /api/ibkr/flex  { queryId?: string }
 * Pide la Flex Query a IBKR (token y query por defecto en variables de entorno del servidor),
 * la convierte a la fila mensual del Panel y la guarda: ibkr_estados_mensuales + importaciones + saldo NAV.
 */
/** Credenciales Flex: la principal (IBKR_FLEX_TOKEN / _QUERY_ID / _QUERY_MTD) y las extra con sufijo _2, _3… (otro login de IBKR). */
function credenciales(hoy: boolean) {
  const out: { token: string; queryId: string; etiqueta: string }[] = [];
  for (const suf of ["", "_2", "_3", "_4"]) {
    const token = process.env[`IBKR_FLEX_TOKEN${suf}`], q = process.env[hoy ? `IBKR_FLEX_QUERY_MTD${suf}` : `IBKR_FLEX_QUERY_ID${suf}`];
    if (token && q) out.push({ token, queryId: q, etiqueta: suf ? `login ${suf.slice(1)}` : "login 1" });
  }
  return out;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // hoy=true usa la query Month-to-Date (NAV al día); si no, la mensual (mes anterior)
  const creds = body?.queryId && process.env.IBKR_FLEX_TOKEN ? [{ token: process.env.IBKR_FLEX_TOKEN, queryId: String(body.queryId), etiqueta: "login 1" }] : credenciales(!!body?.hoy);
  if (!creds.length) return NextResponse.json({ error: "Faltan IBKR_FLEX_TOKEN / IBKR_FLEX_QUERY_ID en Vercel." }, { status: 503 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  try {
    const { data: cuentas } = await supabase.from("cuentas").select("id,nombre").eq("tipo", "inversion");
    const out = [];
    const rows: (ReturnType<typeof parseFlex>[number] & { queryId: string })[] = [];
    for (const cr of creds) {
      try { parseFlex(await fetchFlex(cr.token, cr.queryId)).forEach((r) => rows.push({ ...r, queryId: cr.queryId })); }
      catch (e) { if (creds.length === 1) throw e; out.push({ cuenta: cr.etiqueta, error: (e as Error).message }); }   // un login caído no tumba al otro
    }
    for (const r of rows) {
      const queryId = r.queryId;
      const c = (cuentas ?? []).find((x) => x.nombre.includes(r.cuenta));
      if (!c) { out.push({ cuenta: r.cuenta, error: "cuenta no encontrada en el CRM" }); continue; }
      const periodo = `${r.year}-${String(r.mes).padStart(2, "0")}-01`;
      const archivo = `Flex ${queryId} · ${r.desde}–${r.hasta}${r.parcial ? " (parcial)" : ""}`;
      const { data: imp, error: e0 } = await supabase.from("importaciones").insert({ tipo: "ibkr_csv", archivo, cuenta_id: c.id, periodo, filas: 1, resultado: { flex: true, parcial: r.parcial } }).select("id").single();
      if (e0) throw e0;
      const row = {
        cuenta_id: c.id, periodo, importacion_id: imp.id, moneda_reporte: "USD", moneda_base: "USD", fuente: archivo,
        real_etf: r.re, real_acc: r.ra, real_opc: r.ro, real_fx: r.rf, real_bono: r.rb, nr_etf: r.sne, nr_acc: r.sna, nr_opc: r.sno, nr_fx: r.snf, nr_bono: r.snb,
        div_bruto: r.db, div_ret: r.dr, cupon: r.cb, cupon_ret: r.cr, comisiones: r.cm, int_broker: r.ib, depositos: r.dep,
        nav_efe: r.nav_efe, nav_acc: r.nav_acc, nav_opc: r.nav_opc, nav_bono: r.nav_bono, nav_dev: r.nav_dev, nav_final: r.nav_tot,
        pnl_realizado: r.re + r.ra + r.ro + r.rf + r.rb, pnl_no_realizado: r.sne + r.sna + r.sno + r.snf + r.snb, dividendos: r.db, retenciones: r.dr, intereses: r.ib,
      };
      const { error: e1 } = await supabase.from("ibkr_estados_mensuales").upsert(row, { onConflict: "cuenta_id,periodo" });
      if (e1) throw e1;
      const fechaSaldo = `${r.hasta.slice(0, 4)}-${r.hasta.slice(4, 6)}-${r.hasta.slice(6, 8)}`;
      await supabase.from("saldos_cuenta").upsert({ cuenta_id: c.id, fecha: fechaSaldo, saldo: r.nav_tot, fuente: r.parcial ? "IBKR Flex (hoy)" : "IBKR Flex" }, { onConflict: "cuenta_id,fecha" });
      out.push({ cuenta: c.nombre, periodo, parcial: r.parcial, nav: r.nav_tot, realizada: row.pnl_realizado });
    }
    return NextResponse.json({ ok: true, filas: out });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: e instanceof FlexError ? 502 : 500 });
  }
}
