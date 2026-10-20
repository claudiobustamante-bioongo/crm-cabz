"use client";
import { Fragment, useState } from "react";
import type { IbkrMes, TipoCambio } from "@/lib/types";
import { MESN, fmt } from "@/lib/format";
import { tcFn, yOf, mOf } from "@/lib/contab";
import { TablaFija, Seccion } from "@/components/TablaFija";

const usd = (n: number) => (n < 0 ? "-" : "") + "US$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
type Cta = { id: string; nombre: string; titular: string };
type Linea = { lbl: string; f: (r: IbkrMes) => number; kind: "flujo" | "cierre"; tot?: boolean };

/** Tabla anual de IBKR (como en Inversiones): totales de todas las cuentas y, opcionalmente, desglose por cuenta. Sin estado externo. */
export function TablaAnual({ filas, cuentas, tc, anio, moneda = "mxn", titulo }: { filas: IbkrMes[]; cuentas: Cta[]; tc: TipoCambio[]; anio: number; moneda?: "mxn" | "usd"; titulo?: string }) {
  const [desglose, setDesglose] = useState(false);
  const fix = tcFn(tc);
  const conv = (u: number, m: number) => (moneda === "usd" ? u : u * fix(anio, m));
  const vf = (v: number) => (moneda === "usd" ? usd(v) : fmt(v));
  const rows = (cid: string) => filas.filter((r) => r.cuenta_id === cid && yOf(r) === anio).sort((a, b) => mOf(a) - mOf(b));
  const accs = cuentas.filter((c) => rows(c.id).length);
  const color = (c: Cta) => c.titular !== "CABZ" ? "var(--akela)" : ["var(--c6)", "var(--nec)", "var(--gus)"][accs.filter((x) => x.titular === "CABZ").findIndex((x) => x.id === c.id) % 3];
  const nombre = (c: Cta) => c.nombre.replace(/^IBKR /, "") + (c.titular === "CABZ" ? " · tuya" : " · Akela");

  const fila = (l: Linea, cs: Cta[], sub = false) => {
    let tot = 0; const cells = [];
    const last = Math.max(0, ...cs.map((c) => rows(c.id).at(-1)).map((r) => (r ? mOf(r) : 0)));
    for (let m = 1; m <= 12; m++) {
      let v = 0, any = false;
      cs.forEach((c) => { const r = rows(c.id).find((d) => mOf(d) === m); if (!r) return; const u = l.f(r) || 0; if (l.kind === "cierre") { v += u; any = true; } else if (u) { v += conv(u, m); any = true; } });
      if (l.kind === "cierre" && any) { v = conv(v, m); if (m === last) tot = v; } else tot += v;
      cells.push(any ? <td key={m} className={"n" + (v < 0 ? " neg" : "")}>{vf(v)}</td> : <td key={m} className="n dim">—</td>);
    }
    const cls = [l.tot && !sub ? "tot" : "", sub ? "sub" : desglose && accs.length > 1 ? "lead" : ""].filter(Boolean).join(" ") || undefined;
    return <tr key={(sub ? cs[0].id + "-" : "") + l.lbl} className={cls}>
      <td style={sub ? { paddingLeft: 18 } : undefined}>{sub ? <><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color(cs[0]), marginRight: 5 }} />{nombre(cs[0])}</> : l.lbl}</td>
      {cells}<td className={"n" + (tot < 0 ? " neg" : "")} style={{ fontWeight: 700 }}>{vf(tot)}</td></tr>;
  };
  const line = (l: Linea) => desglose && accs.length > 1 ? <Fragment key={l.lbl}>{fila(l, accs)}{accs.map((c) => fila(l, [c], true))}</Fragment> : fila(l, accs);
  const fReal = (r: IbkrMes) => r.real_etf + r.real_acc + r.real_opc + r.real_fx + r.real_bono;
  const fNR = (r: IbkrMes) => r.nr_etf + r.nr_acc + r.nr_opc + r.nr_fx + r.nr_bono;

  return (
    <div className="card">
      <div className="ct"><span>{titulo ?? `Año ${anio} · ${moneda === "usd" ? "USD" : "MXN al FIX"}`}</span>
        {accs.length > 1 && <label style={{ display: "flex", gap: 5, alignItems: "center", margin: 0, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={desglose} onChange={(e) => setDesglose(e.target.checked)} /> desglose por cuenta</label>}</div>
      {([
        ["1 · Ingresos pasivos (dividendos netos + cupones)", [line({ lbl: "Dividendos netos", f: (r) => r.div_bruto - r.div_ret, kind: "flujo" }), line({ lbl: "Cupones de bonos", f: (r) => r.cupon, kind: "flujo" })]],
        ["2 · Realizada (Cap. IV)", [line({ lbl: "ETFs", f: (r) => r.real_etf, kind: "flujo" }), line({ lbl: "Acciones", f: (r) => r.real_acc, kind: "flujo" }), line({ lbl: "Opciones", f: (r) => r.real_opc, kind: "flujo" }), line({ lbl: "Forex", f: (r) => r.real_fx, kind: "flujo" }), line({ lbl: "Bonos", f: (r) => r.real_bono, kind: "flujo" }), line({ lbl: "Subtotal realizada", f: fReal, kind: "flujo", tot: true })]],
        ["3 · No realizada (saldo de cierre, no suma)", [line({ lbl: "ETFs", f: (r) => r.nr_etf, kind: "cierre" }), line({ lbl: "Acciones", f: (r) => r.nr_acc, kind: "cierre" }), line({ lbl: "Opciones", f: (r) => r.nr_opc, kind: "cierre" }), line({ lbl: "Forex", f: (r) => r.nr_fx, kind: "cierre" }), line({ lbl: "Bonos", f: (r) => r.nr_bono, kind: "cierre" }), line({ lbl: "Subtotal no realizada", f: fNR, kind: "cierre", tot: true })]],
        ["4 · Costos", [line({ lbl: "Comisiones", f: (r) => r.comisiones, kind: "flujo" }), line({ lbl: "Interés bróker", f: (r) => r.int_broker, kind: "flujo" })]],
        ["5 · NAV y depósitos", [line({ lbl: "NAV total (cierre)", f: (r) => r.nav_final, kind: "cierre" }), line({ lbl: "Depósitos netos", f: (r) => r.depositos, kind: "flujo" })]],
        ...(moneda === "mxn" ? [["TC FIX usado", [<tr key="tc"><td>MXN/USD</td>{Array.from({ length: 12 }, (_, i) => <td key={i} className="n">{fix(anio, i + 1) ? fix(anio, i + 1).toFixed(4) : "—"}</td>)}<td /></tr>]] as [string, React.ReactNode[]]] : []),
      ] as [string, React.ReactNode[]][]).map(([t, filas]) => (
        <Seccion key={t} titulo={t}>
          <div className="tbl-cols"><TablaFija grupo={"anual-" + anio}><table>
            <thead><tr><th>Concepto</th>{MESN.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">Año</th></tr></thead>
            <tbody>{filas}</tbody>
          </table></TablaFija></div>
        </Seccion>))}
    </div>
  );
}
