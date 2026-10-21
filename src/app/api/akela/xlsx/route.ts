import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { loadAkela } from "@/lib/data";
import { rolActual } from "@/lib/rol";

export const maxDuration = 60;

const MXN = '"$"#,##0;[Red]-"$"#,##0', MXN2 = '"$"#,##0.00;[Red]-"$"#,##0.00';
const INK = "FF1F2A1F", HEAD = "FFE9E3D2", SEC = "FFF6F2E8", TOT = "FFDDE6D3";
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const anio = Number(new URL(req.url).searchParams.get("anio")) || new Date().getFullYear();
  const rol = await rolActual(supabase);
  const d = await loadAkela(supabase, anio, rol);
  const concil = anio <= 2026;

  type L = { linea: string; categoria: string; subrubro: string | null; pagador: string; transferencia: boolean; anual: boolean; rubro_id: string | null; plan: number[]; real: number[] };
  const map = new Map<string, L>();
  d.plan.forEach((p) => {
    const l = map.get(p.linea) ?? { linea: p.linea, categoria: p.categoria ?? "Sin rubro", subrubro: p.subrubro ?? null, pagador: p.pagador, transferencia: p.es_transferencia, anual: !!p.anual, rubro_id: p.rubro_id, plan: Array(12).fill(0), real: Array(12).fill(0) };
    l.plan[p.mes - 1] = Number(p.monto);
    if (concil) l.real[p.mes - 1] = Number(p.real_conciliado ?? 0);
    map.set(p.linea, l);
  });
  if (!concil) d.movs.forEach((m) => { if (m.estado !== "real") return; const l = [...map.values()].find((x) => x.rubro_id && x.rubro_id === m.rubro_id); if (l) l.real[Number(m.fecha.slice(5, 7)) - 1] += m.monto_mxn; });
  const lineas = [...map.values()].sort((a, b) => (a.pagador === "CABZ" ? 0 : 1) - (b.pagador === "CABZ" ? 0 : 1) || a.categoria.localeCompare(b.categoria, "es") || a.linea.localeCompare(b.linea, "es"));

  const wb = new ExcelJS.Workbook(); wb.creator = "CRM CABZ"; wb.created = new Date();
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  /* ---------- 1. Plan vs real ---------- */
  const ws = wb.addWorksheet(`Akela ${anio}`);
  ws.getCell("A1").value = `Presupuesto Akela ${anio} · plan vs real`; ws.getCell("A1").font = { bold: true, size: 14, color: { argb: INK } };
  ws.getCell("A2").value = concil ? "Real = conciliación con tu tabla (ene–oct)." : "Real = gastos registrados en el libro Akela."; ws.getCell("A2").font = { italic: true, color: { argb: "FF6B6B5E" } };
  const cols = ["Rubro", "Concepto", "Subrubro", "Quién", ...MESES.map((m) => `Plan ${m}`), "Plan año", ...MESES.map((m) => `Real ${m}`), "Real año", "Desviación"];
  const hr = ws.getRow(4); hr.values = cols; hr.font = { bold: true, color: { argb: INK } }; hr.fill = fill(HEAD); hr.height = 28; hr.alignment = { wrapText: true, vertical: "middle" };
  [18, 28, 24, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = 5; c <= cols.length; c++) ws.getColumn(c).width = 11;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }];
  let r = 5; const firstYo = r; let lastYo = r; let grupo = "";
  const put = (l: L) => {
    const row = ws.getRow(r);
    row.values = [l.categoria, l.linea + (l.anual ? " (anual)" : "") + (l.transferencia ? " (transferencia)" : ""), l.subrubro ?? "", l.pagador, ...l.plan, 0, ...l.real, 0, 0];
    row.getCell(17).value = { formula: `SUM(E${r}:P${r})` }; row.getCell(30).value = { formula: `SUM(R${r}:AC${r})` }; row.getCell(31).value = { formula: `AD${r}-Q${r}` };
    for (let c = 5; c <= 31; c++) row.getCell(c).numFmt = MXN;
    r++;
  };
  const tot = (label: string, from: number, to: number) => {
    const row = ws.getRow(r); row.getCell(1).value = label; row.font = { bold: true }; row.fill = fill(TOT);
    for (let c = 5; c <= 31; c++) { const L = ws.getColumn(c).letter; row.getCell(c).value = { formula: `SUM(${L}${from}:${L}${to})` }; row.getCell(c).numFmt = MXN; }
    r++;
  };
  const yo = lineas.filter((l) => l.pagador === "CABZ"), ellos = lineas.filter((l) => l.pagador !== "CABZ" && l.pagador !== "HAMB"), lm = lineas.filter((l) => l.pagador === "HAMB");
  yo.forEach((l) => { if (l.categoria !== grupo) { grupo = l.categoria; const s = ws.getRow(r); s.getCell(1).value = grupo; s.font = { bold: true }; s.fill = fill(SEC); r++; } put(l); lastYo = r - 1; });
  tot("Pago yo (gastos + depósitos)", firstYo, lastYo);
  r++;
  if (ellos.length) { const s = ws.getRow(r); s.getCell(1).value = "Papá y mamá cubren con el depósito (informativo)"; s.font = { bold: true }; s.fill = fill(SEC); r++; const f = r; ellos.forEach(put); tot("Informativo papá y mamá", f, r - 1); r++; }
  if (lm.length) { const s = ws.getRow(r); s.getCell(1).value = "Luis Miguel (informativo, al fondo)"; s.font = { bold: true }; s.fill = fill(SEC); r++; lm.forEach(put); }

  /* ---------- 2. Gastos registrados ---------- */
  const wg = wb.addWorksheet("Gastos Akela");
  wg.getCell("A1").value = `Gastos del libro Akela ${anio}`; wg.getCell("A1").font = { bold: true, size: 14, color: { argb: INK } };
  const hg = wg.getRow(3); hg.values = ["Fecha", "Concepto", "Subrubro", "Cuenta", "Pagador", "Estado", "Notas", "Monto MXN"]; hg.font = { bold: true, color: { argb: INK } }; hg.fill = fill(HEAD);
  [12, 36, 26, 18, 9, 11, 36, 14].forEach((w, i) => { wg.getColumn(i + 1).width = w; });
  wg.views = [{ state: "frozen", ySplit: 3 }];
  const rubroNombre = (id: string | null) => d.rubros.find((x) => x.id === id)?.nombre ?? "";
  let g = 4; d.movs.forEach((m) => { const row = wg.getRow(g++); row.values = [m.fecha, m.descripcion ?? "", rubroNombre(m.rubro_id), m.cuenta ?? "", m.pagador ?? "", m.estado, m.notas ?? "", m.monto_mxn]; row.getCell(8).numFmt = MXN2; });
  if (g > 4) { const row = wg.getRow(g); row.getCell(1).value = "Total"; row.font = { bold: true }; row.fill = fill(TOT); row.getCell(8).value = { formula: `SUM(H4:H${g - 1})` }; row.getCell(8).numFmt = MXN2; }

  /* ---------- 3. Fondo: aportaciones y retiros ---------- */
  const wf = wb.addWorksheet("Fondo");
  wf.getCell("A1").value = `Fondo Akela ${anio} · aportaciones y retiros`; wf.getCell("A1").font = { bold: true, size: 14, color: { argb: INK } };
  const hf = wf.getRow(3); hf.values = ["Fecha", "Concepto", "Quién", "Descripción", "Entrada", "Salida"]; hf.font = { bold: true, color: { argb: INK } }; hf.fill = fill(HEAD);
  [12, 12, 8, 44, 14, 14].forEach((w, i) => { wf.getColumn(i + 1).width = w; });
  let f = 4; d.libro.filter((x) => x.concepto !== "gasto").forEach((x) => { const row = wf.getRow(f++); row.values = [x.fecha, x.concepto, x.quien ?? "CABZ", x.descripcion ?? "", x.entrada_mxn, x.salida_mxn]; row.getCell(5).numFmt = MXN2; row.getCell(6).numFmt = MXN2; });
  if (f > 4) { const row = wf.getRow(f); row.getCell(1).value = "Total"; row.font = { bold: true }; row.fill = fill(TOT); row.getCell(5).value = { formula: `SUM(E4:E${f - 1})` }; row.getCell(6).value = { formula: `SUM(F4:F${f - 1})` }; row.getCell(5).numFmt = MXN2; row.getCell(6).numFmt = MXN2; }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Akela_${anio}.xlsx"` } });
}
