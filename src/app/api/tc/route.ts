import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/tc?anio=2026 → trae el FIX (serie SF43718) de Banxico para el año,
 * toma el último dato de cada mes (cierre) y lo guarda en tipos_cambio (fecha = día 1 del mes).
 * El token vive en BANXICO_TOKEN (variable de entorno del servidor; nunca en la base ni en el navegador).
 */
export async function GET(req: Request) {
  const token = (process.env.BANXICO_TOKEN ?? "").trim().replace(/^["']|["']$/g, "");
  if (!token) return NextResponse.json({ error: "BANXICO_TOKEN no configurado en Vercel." }, { status: 503 });
  if (!/^[0-9a-f]{64}$/i.test(token)) return NextResponse.json({ error: `BANXICO_TOKEN con formato raro (${token.length} caracteres; debe ser 64 hex). Revísalo en Vercel.` }, { status: 503 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const anio = Number(new URL(req.url).searchParams.get("anio")) || new Date().getFullYear();
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });
  const fin = anio < +hoy.slice(0, 4) ? `${anio}-12-31` : hoy;   // Banxico rechaza rangos que terminan en el futuro
  const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/${anio}-01-01/${fin}`;
  const r = await fetch(url, { headers: { "Bmx-Token": token, Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) { const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200); return NextResponse.json({ error: `Banxico respondió ${r.status}${t ? `: ${t}` : ""}` }, { status: 502 }); }
  const j = await r.json();
  const datos: { fecha: string; dato: string }[] = j?.bmx?.series?.[0]?.datos ?? [];

  // último dato hábil de cada mes
  const porMes: Record<string, { fecha: string; v: number }> = {};
  for (const d of datos) {
    const v = Number(d.dato);
    if (!isFinite(v)) continue;                       // "N/E"
    const [dd, mm, yy] = d.fecha.split("/");          // dd/mm/yyyy
    const iso = `${yy}-${mm}-${dd}`, k = `${yy}-${mm}`;
    if (!porMes[k] || iso > porMes[k].fecha) porMes[k] = { fecha: iso, v };
  }
  const rows = Object.entries(porMes).map(([k, x]) => ({ fecha: `${k}-01`, moneda: "USD", tc_mxn: x.v, fuente: `Banxico FIX cierre ${x.fecha}` }));
  if (!rows.length) return NextResponse.json({ error: "Banxico no devolvió datos para ese año." }, { status: 502 });

  const { error } = await supabase.from("tipos_cambio").upsert(rows, { onConflict: "fecha,moneda" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ anio, meses: rows.length, rows });
}
