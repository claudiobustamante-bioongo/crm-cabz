"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FlujoData } from "@/lib/types";
import { fmt, ml } from "@/lib/format";
import { TablaFija } from "@/components/TablaFija";

const TIPO_LABEL: Record<string, string> = { sueldo: "Nómina", comision: "Comisiones (Bioongo)", bono: "Bonos / aguinaldo", dividendo_interes: "Dividendos e intereses", otro: "Otros ingresos" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Flujo de caja dinámico, base efectivo: Caja inicial + entradas − salidas = caja final (= inicial del siguiente mes).
 * Pasado: lo real. Mes en curso: anclado al saldo de cheques de hoy; lo que falta del presupuesto se asume pagado este mes.
 * Futuro: presupuesto. Los cargos a tarjeta no salen de caja al gastarse sino al pagar la tarjeta (fila «Pago de tarjetas»).
 */
export function FlujoCaja({ d, cheques, hoy, aviso }: { d: FlujoData; cheques: number; hoy: string; aviso: (t: string) => void }) {
  const supabase = createClient(); const router = useRouter();
  const [pptos, setPptos] = useState(d.pptos);
  const mesHoy = hoy.slice(0, 7); const iHoy = d.meses.indexOf(mesHoy);
  const nombre = (id: string | null) => d.rubros.find((r) => r.id === id);
  const grupoDe = (id: string | null) => { const r = nombre(id); const p = r?.padre_id ? d.rubros.find((x) => x.id === r.padre_id) : null; return p?.nombre ?? r?.nombre ?? "Otros"; };

  /* ---------- filas ---------- */
  const tiposIng = [...new Set(d.ingresos.map((i) => i.tipo))].sort((a, b) => Object.keys(TIPO_LABEL).indexOf(a) - Object.keys(TIPO_LABEL).indexOf(b));
  const ing = (m: string, tipo: string) => sum(d.ingresos.filter((i) => i.mes === m && i.tipo === tipo).map((i) => i.monto_mxn));
  const ingProy = (m: string) => d.ingresos.some((i) => i.mes === m && i.proyectado);
  // líneas de presupuesto = unión de rubros con presupuesto en cualquier mes mostrado
  const lineas = useMemo(() => { const m = new Map<string, { rubro_id: string; libro: string }>(); pptos.forEach((p) => m.set(`${p.libro}|${p.rubro_id}`, { rubro_id: p.rubro_id, libro: p.libro })); return [...m.values()].map((l) => ({ ...l, nombre: nombre(l.rubro_id)?.nombre ?? "?", grupo: grupoDe(l.rubro_id) })).sort((a, b) => a.grupo.localeCompare(b.grupo, "es") || a.nombre.localeCompare(b.nombre, "es")); }, [pptos, d.rubros]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ppto = (m: string, l: { rubro_id: string; libro: string }) => pptos.find((p) => p.mes === m && p.rubro_id === l.rubro_id && p.libro === l.libro);
  const unicaDelLibro = (m: string, l: { libro: string }) => l.libro !== "PERSONAL" && pptos.filter((p) => p.mes === m && p.libro === l.libro).length === 1;
  const realLinea = (m: string, l: { rubro_id: string; libro: string }) => sum(d.gastos.filter((g) => g.mes === m && (unicaDelLibro(m, l) ? g.libro === l.libro : g.rubro_id === l.rubro_id)).map((g) => g.monto_mxn));
  const esperado = (m: string, l: { rubro_id: string; libro: string }) => { const p = ppto(m, l)?.monto ?? 0; const i = d.meses.indexOf(m); if (i < iHoy) return realLinea(m, l); if (i === iHoy) return Math.max(p, realLinea(m, l)); return p; };
  // gastos reales fuera de líneas
  const fuera = (m: string) => { const i = d.meses.indexOf(m); if (i > iHoy) return 0; const cub = (g: FlujoData["gastos"][number]) => lineas.some((l) => unicaDelLibro(m, l) ? g.libro === l.libro : g.rubro_id === l.rubro_id); return sum(d.gastos.filter((g) => g.mes === m && !cub(g)).map((g) => g.monto_mxn)); };
  const pagoTarj = (m: string) => { const i = d.meses.indexOf(m); const real = sum(d.pagosTarjeta.filter((p) => p.mes === m).map((p) => p.monto_mxn)); if (i < iHoy) return real; if (i === iHoy) return real + (real > 0 ? 0 : d.tarjetasDeuda); return 0; };   // la deuda de hoy se paga a fin del mes en curso
  const ahorro = (m: string, tipo: string) => sum(d.ahorros.filter((a) => a.mes === m && a.tipo === tipo).map((a) => a.monto_mxn));
  // caja: lo que realmente sale de cheques. Pasado/presente: gastos pagados con cheques + pagos de tarjeta + ahorro/abonos (+ en curso: lo que falta, asumido en efectivo). Futuro: presupuesto + ahorro planeado 0.
  const salidaCaja = (m: string) => {
    const i = d.meses.indexOf(m);
    const cash = sum(d.gastos.filter((g) => g.mes === m && g.cuenta_tipo !== "tarjeta").map((g) => g.monto_mxn));
    const falta = i === iHoy ? sum(lineas.map((l) => Math.max(0, (ppto(m, l)?.monto ?? 0) - realLinea(m, l)))) : 0;
    const futuro = i > iHoy ? sum(lineas.map((l) => ppto(m, l)?.monto ?? 0)) : 0;
    return (i <= iHoy ? cash + falta : futuro) + pagoTarj(m) + ahorro(m, "ahorro") + ahorro(m, "abono_deuda");
  };
  const entradas = (m: string) => sum(tiposIng.map((t) => ing(m, t)));
  // cadena de caja anclada en hoy
  const caja: Record<string, { ini: number; fin: number }> = {};
  { const hoyIni = cheques - sum(d.ingresos.filter((i) => i.mes === mesHoy && !i.proyectado).map((i) => i.monto_mxn)) + sum(d.gastos.filter((g) => g.mes === mesHoy && g.cuenta_tipo !== "tarjeta").map((g) => g.monto_mxn)) + sum(d.pagosTarjeta.filter((p) => p.mes === mesHoy).map((p) => p.monto_mxn)) + ahorro(mesHoy, "ahorro") + ahorro(mesHoy, "abono_deuda");
    let ini = hoyIni; for (let i = iHoy; i < d.meses.length; i++) { const m = d.meses[i]; const fin = ini + entradas(m) - salidaCaja(m); caja[m] = { ini, fin }; ini = fin; }
    let fin = hoyIni; for (let i = iHoy - 1; i >= 0; i--) { const m = d.meses[i]; const ini2 = fin - entradas(m) + salidaCaja(m); caja[m] = { ini: ini2, fin }; fin = ini2; } }

  const setPpto = async (m: string, l: { rubro_id: string; libro: string }, monto: number) => {
    const ex = ppto(m, l);
    if (ex) { const { error } = await supabase.from("presupuestos").update({ monto }).eq("id", ex.id); if (error) return aviso(error.message); setPptos((p) => p.map((x) => x.id === ex.id ? { ...x, monto } : x)); }
    else { const { data: lb } = await supabase.from("libros").select("id").eq("codigo", l.libro).single(); const { data: pg } = await supabase.from("pagadores").select("id").eq("codigo", "CABZ").single();
      const { data, error } = await supabase.from("presupuestos").upsert({ mes: `${m}-01`, libro_id: lb?.id, rubro_id: l.rubro_id, pagador_id: pg?.id, monto }, { onConflict: "user_id,mes,libro_id,rubro_id,pagador_id" }).select("id").single(); if (error) return aviso(error.message); setPptos((p) => [...p, { id: data.id, mes: m, rubro_id: l.rubro_id, libro: l.libro, monto }]); }
    router.refresh();
  };
  const copiarMes = async (de: string, a: string) => {
    const src = pptos.filter((p) => p.mes === de); if (!src.length) return aviso(`${ml(de)} no tiene presupuesto.`);
    if (!confirm(`Copiar ${src.length} líneas de ${ml(de)} a ${ml(a)}? No borra lo que ya haya.`)) return;
    for (const p of src) if (!ppto(a, p)) await setPpto(a, p, p.monto);
    aviso("Copiado.");
  };

  const grupos = [...new Set(lineas.map((l) => l.grupo))];
  const cell = (v: number, opts?: { neg?: boolean; strong?: boolean; dim?: boolean }) => <td className={"n" + (opts?.neg && v < 0 ? " neg" : "")} style={{ fontWeight: opts?.strong ? 700 : undefined, color: opts?.dim ? "var(--gray-soft)" : undefined }}>{v ? fmt(v) : "·"}</td>;

  return (
    <div className="card full-bleed">
      <div className="ct"><span>Flujo de caja dinámico</span><span className="tag">base efectivo · pasado real · {ml(mesHoy)} anclado a cheques hoy ({fmt(cheques)}) · futuro presupuesto (editable)</span></div>
      <TablaFija grupo="flujo" alto="75vh"><table style={{ fontSize: 12 }}>
        <thead><tr><th style={{ minWidth: 220 }}>Concepto</th>{d.meses.map((m, i) => <th key={m} className="n" style={i === iHoy ? { textDecoration: "underline" } : i > iHoy ? { color: "var(--gray-soft)" } : undefined}>{ml(m)}{i === iHoy ? " (hoy)" : i > iHoy ? " proy." : ""}</th>)}</tr></thead>
        <tbody>
          <tr className="tot"><td>Caja inicial</td>{d.meses.map((m) => cell(caja[m].ini, { neg: true, strong: true }))}</tr>
          <tr className="sec"><td colSpan={d.meses.length + 1}>Entradas</td></tr>
          {tiposIng.map((t) => <tr key={t}><td>{TIPO_LABEL[t] ?? t}</td>{d.meses.map((m) => <td key={m} className="n pos" style={{ opacity: ingProy(m) && d.meses.indexOf(m) >= iHoy ? 0.75 : 1 }}>{ing(m, t) ? fmt(ing(m, t)) : "·"}</td>)}</tr>)}
          <tr className="lead"><td><b>Total entradas</b></td>{d.meses.map((m) => cell(entradas(m), { strong: true }))}</tr>
          <tr className="sec"><td colSpan={d.meses.length + 1}>Ahorro y deuda</td></tr>
          <tr><td>Traspasos a inversión / ahorro</td>{d.meses.map((m) => cell(ahorro(m, "ahorro")))}</tr>
          <tr><td>Abonos a préstamos</td>{d.meses.map((m) => cell(ahorro(m, "abono_deuda")))}</tr>
          <tr><td>Pago de tarjetas <span className="hint">(deuda hoy {fmt(d.tarjetasDeuda)}, se paga al cierre del mes)</span></td>{d.meses.map((m) => cell(pagoTarj(m), { dim: d.meses.indexOf(m) >= iHoy && !d.pagosTarjeta.some((p) => p.mes === m) }))}</tr>
          <tr className="sec"><td colSpan={d.meses.length + 1}>Gastos <span className="hint">· pasado: real · hoy: mayor entre esperado y real · futuro: esperado (clic para editar)</span></td></tr>
          {grupos.map((g) => (
            <Fragment key={g}>
              <tr><td style={{ fontWeight: 600, color: "var(--ink)" }}>{g}</td>{d.meses.map((m) => cell(sum(lineas.filter((l) => l.grupo === g).map((l) => esperado(m, l))), { strong: true }))}</tr>
              {lineas.filter((l) => l.grupo === g).map((l) => (
                <tr key={`${l.libro}|${l.rubro_id}`} className="sub"><td style={{ paddingLeft: 18 }}>{l.nombre}{l.libro !== "PERSONAL" ? <span className="badge" style={{ marginLeft: 6 }}>{l.libro}</span> : null}</td>
                  {d.meses.map((m, i) => { const real = realLinea(m, l), p = ppto(m, l)?.monto ?? 0; return (
                    <td key={m} className="n" style={{ padding: "1px 4px" }}>
                      {i < iHoy ? <span>{real ? fmt(real) : "·"}</span>
                        : <input type="number" defaultValue={p || ""} placeholder={real ? fmt(real) : "·"} title={`real ${fmt(real)} · esperado ${fmt(p)}`} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== p) setPpto(m, l, v); }} style={{ width: 84, textAlign: "right", padding: "2px 4px", fontSize: 12, color: i === iHoy && real > p && p ? "var(--neg)" : undefined, background: i === iHoy && real >= p && p ? "var(--cream)" : undefined }} />}
                      {i === iHoy && real > 0 && <div className="hint" style={{ fontSize: 10 }}>real {fmt(real)}</div>}
                    </td>); })}
                </tr>))}
            </Fragment>))}
          <tr><td style={{ fontWeight: 600, color: "var(--ink)" }}>Otros gastos (sin línea)</td>{d.meses.map((m) => cell(fuera(m)))}</tr>
          <tr className="lead"><td><b>Total salidas de caja</b></td>{d.meses.map((m) => cell(salidaCaja(m), { strong: true }))}</tr>
          <tr className="tot"><td>Caja final <span className="hint">→ inicial del siguiente</span></td>{d.meses.map((m) => cell(caja[m].fin, { neg: true, strong: true }))}</tr>
        </tbody>
      </table></TablaFija>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap", fontSize: 12 }}>
        <span>Copiar presupuesto:</span>
        <select id="fc-de" defaultValue={mesHoy}>{d.meses.map((m) => <option key={m} value={m}>{ml(m)}</option>)}</select><span>→</span>
        <select id="fc-a" defaultValue={d.meses[Math.min(iHoy + 1, d.meses.length - 1)]}>{d.meses.map((m) => <option key={m} value={m}>{ml(m)}</option>)}</select>
        <button className="btn ghost sm" type="button" onClick={() => copiarMes((document.getElementById("fc-de") as HTMLSelectElement).value, (document.getElementById("fc-a") as HTMLSelectElement).value)}>copiar</button>
        <span className="hint">Las líneas nuevas se agregan desde Gastos → Caja del mes. Los cargos a tarjeta se restan de caja cuando pagas la tarjeta, no al gastarlos.</span>
      </div>
    </div>);
}
