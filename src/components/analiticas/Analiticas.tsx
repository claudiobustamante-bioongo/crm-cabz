"use client";
import { useMemo, useState } from "react";
import type { AnaliticasData } from "@/lib/types";
import { CLS_COLOR, CLS_LABEL, color, fmt, ml, niceStep } from "@/lib/format";
import { Dona } from "@/components/gastos/Graficas";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + " %" : "—");
const k = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1000 ? Math.round(v / 1000) + "k" : String(Math.round(v)));
const mesLargo = (m: string) => ml(m);

/** Barras ingresos vs gastos por mes + línea de ahorro neto acumulado. */
function FlujoChart({ meses, ing, gas }: { meses: string[]; ing: number[]; gas: number[] }) {
  const W = 760, H = 230, P = { l: 54, r: 54, t: 12, b: 26 };
  const max = Math.max(...ing, ...gas, 1); const step = niceStep(max); const top = Math.ceil(max / step) * step;
  const acum: number[] = []; ing.forEach((v, i) => acum.push((acum[i - 1] ?? 0) + v - gas[i]));
  const amin = Math.min(0, ...acum), amax = Math.max(0, ...acum, 1);
  const bw = (W - P.l - P.r) / meses.length, y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / top), y2 = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - amin) / (amax - amin || 1));
  const grid: number[] = []; for (let v = 0; v <= top; v += step) grid.push(v);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Ingresos, gastos y ahorro acumulado">
      {grid.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end">{k(v)}</text></g>)}
      {meses.map((m, i) => { const x = P.l + i * bw; const w = bw * 0.36; return (
        <g key={m}>
          <rect x={x + bw * 0.1} y={y(ing[i])} width={w} height={y(0) - y(ing[i])} fill="var(--nec)" stroke="var(--ink)" strokeWidth={0.6}><title>{`${mesLargo(m)} · ingresos ${fmt(ing[i])}`}</title></rect>
          <rect x={x + bw * 0.1 + w} y={y(gas[i])} width={w} height={y(0) - y(gas[i])} fill="var(--deu)" stroke="var(--ink)" strokeWidth={0.6}><title>{`${mesLargo(m)} · gastos ${fmt(gas[i])}`}</title></rect>
          {i % 2 === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle">{mesLargo(m)}</text>}
        </g>); })}
      <polyline fill="none" stroke="var(--aho)" strokeWidth={2.5} points={acum.map((v, i) => `${P.l + i * bw + bw / 2},${y2(v)}`).join(" ")} />
      {acum.map((v, i) => <circle key={i} cx={P.l + i * bw + bw / 2} cy={y2(v)} r={2.5} fill="var(--aho)"><title>{`${mesLargo(meses[i])} · ahorro acumulado ${fmt(v)}`}</title></circle>)}
      <text x={W - P.r + 6} y={y2(amax) + 4}>{k(amax)}</text><text x={W - P.r + 6} y={y2(amin) + 4}>{k(amin)}</text>
      <text x={W - P.r + 6} y={P.t + 2} fill="var(--aho)" fontWeight={700}>acum.</text>
    </svg>);
}

/** Patrimonio por mes: barras apiladas (inversión, retiro, efectivo, −deuda) + línea neto + proyección punteada. */
function PatrimonioChart({ meses, series, neto, proy }: { meses: string[]; series: { nombre: string; color: string; vals: number[] }[]; neto: number[]; proy: number[] }) {
  const W = 760, H = 250, P = { l: 60, r: 10, t: 12, b: 26 };
  const n = meses.length + proy.length;
  const pos = meses.map((_, i) => sum(series.map((s) => Math.max(0, s.vals[i])))), neg = meses.map((_, i) => sum(series.map((s) => Math.min(0, s.vals[i]))));
  const max = Math.max(...pos, ...neto, ...proy, 1), min = Math.min(...neg, 0); const step = niceStep(max - min); const top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
  const bw = (W - P.l - P.r) / n, y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - bot) / (top - bot || 1));
  const grid: number[] = []; for (let v = bot; v <= top; v += step) grid.push(v);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Patrimonio por mes">
      {grid.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--ink)" : "var(--border-soft)"} /><text x={P.l - 6} y={y(v) + 4} textAnchor="end">{k(v)}</text></g>)}
      {meses.map((m, i) => { let up = 0, dn = 0; const x = P.l + i * bw + bw * 0.15, w = bw * 0.7; return (
        <g key={m}>
          {series.map((s) => { const v = s.vals[i]; if (!v) return null; let el; if (v > 0) { el = <rect key={s.nombre} x={x} y={y(up + v)} width={w} height={y(up) - y(up + v)} fill={s.color} stroke="var(--ink)" strokeWidth={0.5}><title>{`${mesLargo(m)} · ${s.nombre} ${fmt(v)}`}</title></rect>; up += v; } else { el = <rect key={s.nombre} x={x} y={y(dn)} width={w} height={y(dn + v) - y(dn)} fill={s.color} stroke="var(--ink)" strokeWidth={0.5}><title>{`${mesLargo(m)} · ${s.nombre} ${fmt(v)}`}</title></rect>; dn += v; } return el; })}
          {i % 2 === 0 && <text x={x + w / 2} y={H - 8} textAnchor="middle">{mesLargo(m)}</text>}
        </g>); })}
      <polyline fill="none" stroke="var(--ink)" strokeWidth={2.5} points={neto.map((v, i) => `${P.l + i * bw + bw / 2},${y(v)}`).join(" ")} />
      {proy.length > 0 && <polyline fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4" points={[neto[neto.length - 1], ...proy].map((v, i) => `${P.l + (meses.length - 1 + i) * bw + bw / 2},${y(v)}`).join(" ")} />}
      {proy.map((v, i) => <g key={i}><circle cx={P.l + (meses.length + i) * bw + bw / 2} cy={y(v)} r={2.5} fill="var(--paper)" stroke="var(--ink)"><title>{`proyección +${i + 1} m · ${fmt(v)}`}</title></circle>{(i + 1) % 3 === 0 && <text x={P.l + (meses.length + i) * bw + bw / 2} y={H - 8} textAnchor="middle" fill="var(--gray-soft)">+{i + 1}m</text>}</g>)}
    </svg>);
}

export function Analiticas({ initial }: { initial: AnaliticasData }) {
  const d = initial;
  const meses = d.meses; const n = meses.length; const ult = meses[n - 1];
  const [rango, setRango] = useState<12 | 24>(12);
  const mesesR = meses.slice(n - rango);
  const [tasaProy, setTasaProy] = useState(0);        // rendimiento anual asumido en la proyección

  /* ---------- flujo ---------- */
  const ingMes = meses.map((m) => sum(d.ingresos.filter((x) => x.mes === m).map((x) => x.monto_mxn)));
  const gasMes = meses.map((m) => sum(d.gastos.filter((x) => x.mes === m && x.tipo === "gasto").map((x) => x.monto_mxn)));
  const ahorroMes = meses.map((m) => sum(d.gastos.filter((x) => x.mes === m && x.tipo === "ahorro").map((x) => x.monto_mxn)));
  const deudaMes = meses.map((m) => sum(d.gastos.filter((x) => x.mes === m && x.tipo === "abono_deuda").map((x) => x.monto_mxn)));
  const salidaMes = meses.map((_, i) => gasMes[i] + ahorroMes[i] + deudaMes[i]);
  const cerrados = meses.slice(0, n - 1);   // el mes actual está incompleto
  const idx = (m: string) => meses.indexOf(m);
  const ult12 = cerrados.slice(-12), ult3 = cerrados.slice(-3);
  const ing12 = sum(ult12.map((m) => ingMes[idx(m)])), gas12 = sum(ult12.map((m) => gasMes[idx(m)])), sal12 = sum(ult12.map((m) => salidaMes[idx(m)]));
  const gas3 = sum(ult3.map((m) => gasMes[idx(m)])) / Math.max(1, ult3.length), gasProm12 = gas12 / Math.max(1, ult12.length);
  const ahorro12 = ing12 - sum(ult12.map((m) => gasMes[idx(m)] + deudaMes[idx(m)]));
  const tasaAhorro = ing12 ? ahorro12 / ing12 : 0;

  /* ---------- patrimonio ---------- */
  const tcAt = (fecha: string) => { let t = d.tc[0]?.tc_mxn ?? 18.5; for (const x of d.tc) { if (x.fecha <= fecha) t = x.tc_mxn; else break; } return t; };
  const finMes = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
  const cuenta = (id: string) => d.cuentas.find((c) => c.id === id);
  const invMes = meses.map((m) => { const porCta = new Map<string, number>(); d.navHist.filter((r) => r.periodo <= m).forEach((r) => porCta.set(r.cuenta_id, r.nav_final)); return sum([...porCta].map(([id, v]) => { const c = cuenta(id); return c?.tipo === "inversion" ? (c.moneda === "USD" ? v * tcAt(finMes(m)) : v) : 0; })); });
  const retMes = meses.map((m) => { const porCta = new Map<string, number>(); d.saldosHist.filter((r) => r.fecha <= finMes(m)).forEach((r) => porCta.set(r.cuenta_id, r.saldo)); return sum([...porCta].map(([id, v]) => { const c = cuenta(id); return c?.tipo === "retiro" ? (c.moneda === "USD" ? v * tcAt(finMes(m)) : v) : 0; })); });
  const nw = d.netWorth; const efectivo = nw?.efectivo_mxn ?? 0, tarjetas = nw?.tarjetas_mxn ?? 0, prestamos = nw?.prestamos_mxn ?? 0;
  // efectivo y deudas: sólo hay saldo actual → se reconstruyen hacia atrás con el flujo neto (aprox.)
  const efeMes = meses.map((_, i) => { let e = efectivo; for (let j = n - 1; j > i; j--) e -= ingMes[j] - salidaMes[j]; return e; });
  const deuMes = meses.map(() => -(tarjetas + prestamos));
  const netoMes = meses.map((_, i) => invMes[i] + retMes[i] + efeMes[i] + deuMes[i]);
  const netoHoy = nw?.neto_mxn ?? netoMes[n - 1];
  const ahorroProm = ahorro12 / Math.max(1, ult12.length);
  const proy = Array.from({ length: 12 }, (_, i) => { let v = netoHoy; for (let j = 0; j <= i; j++) v = v * (1 + tasaProy / 12) + ahorroProm; return v; });
  const hace12 = netoMes[Math.max(0, n - 13)];

  /* ---------- dónde se va ---------- */
  const g12 = d.gastos.filter((x) => ult12.includes(x.mes) && x.tipo === "gasto");
  const porCls = ["N", "G", "A", "D"].map((c) => [CLS_LABEL[c], sum(g12.filter((x) => (x.clasificacion ?? "N") === c).map((x) => x.monto_mxn))] as [string, number]).filter((x) => x[1] > 0);
  const porLibro = [...new Set(g12.map((x) => x.libro))].map((l) => [l, sum(g12.filter((x) => x.libro === l).map((x) => x.monto_mxn))] as [string, number]).sort((a, b) => b[1] - a[1]);
  const [selGrupo, setSelGrupo] = useState("");
  const grupos = useMemo(() => { const m = new Map<string, { t12: number; t3: number }>(); d.gastos.filter((x) => x.tipo === "gasto").forEach((x) => { const g = m.get(x.grupo) ?? { t12: 0, t3: 0 }; if (ult12.includes(x.mes)) g.t12 += x.monto_mxn; if (ult3.includes(x.mes)) g.t3 += x.monto_mxn; m.set(x.grupo, g); }); return [...m].map(([g, v]) => ({ grupo: g, prom12: v.t12 / Math.max(1, ult12.length), prom3: v.t3 / Math.max(1, ult3.length), t12: v.t12 })).filter((x) => x.t12 > 0).sort((a, b) => b.t12 - a.t12); }, [d.gastos, ult12, ult3]);
  const subs = selGrupo ? (() => { const m = new Map<string, number>(); g12.filter((x) => x.grupo === selGrupo).forEach((x) => m.set(x.rubro, (m.get(x.rubro) ?? 0) + x.monto_mxn)); return [...m].sort((a, b) => b[1] - a[1]); })() : [];

  /* ---------- compromisos ---------- */
  const prox = Array.from({ length: 3 }, (_, i) => { const dte = new Date(Date.UTC(+ult.slice(0, 4), +ult.slice(5, 7) - 1 + i + 1, 1)); return dte.toISOString().slice(0, 7); });
  const futPorMes = (m: string) => d.futuros.filter((f) => f.mes === m);
  const msiPend = d.futuros.filter((f) => f.estado === "real" && /MSI/.test(f.notas ?? ""));
  const deudaPagosMes = (m: string) => sum(d.deudas.filter((x) => x.proximo_pago_fecha && x.proximo_pago_fecha.slice(0, 7) <= m && (x.pagos_restantes ?? 0) > 0).map((x) => (x.proximo_pago_monto ?? 0) * (x.moneda === "USD" ? tcAt(d.hoy) : x.moneda === "EUR" ? tcAt(d.hoy) * 1.08 : 1)));
  const akelaMes = d.akela ? d.akela.plan_anual / 12 : 0;
  const ingProm = ing12 / Math.max(1, ult12.length);
  const runway = gas3 ? (efectivo - tarjetas) / gas3 : Infinity;

  /* ---------- composición ---------- */
  const comp = d.cuentas.filter((c) => c.saldo_mxn > 0 && c.tipo !== "tarjeta_credito").map((c) => [c.nombre, c.saldo_mxn] as [string, number]).sort((a, b) => b[1] - a[1]);
  const compTot = sum(comp.map((x) => x[1]));
  const [selCta, setSelCta] = useState("");

  const Stat = ({ v, l, cls }: { v: string; l: string; cls?: string }) => <div className="stat"><div className={"v " + (cls ?? "")}>{v}</div><div className="l">{l}</div></div>;

  return (
    <section>
      <div className="idea"><b>Analíticas</b> Lo que importa de un vistazo: cuánto entra y sale, cuánto ahorras, cómo crece tu patrimonio y qué compromisos vienen. Los meses se cuentan cerrados (el actual no entra en promedios). Mi parte de los gastos (pagador CABZ), todos los libros.</div>

      {/* ---------- 1. tarjetas ---------- */}
      <div className="card">
        <div className="ct"><span>Hoy · {d.hoy}</span><span className="pills" style={{ margin: 0 }}><button type="button" className="pill" aria-pressed={rango === 12} onClick={() => setRango(12)}>12 meses</button><button type="button" className="pill" aria-pressed={rango === 24} onClick={() => setRango(24)}>24 meses</button></span></div>
        <div className="stat-row">
          <Stat v={fmt(netoHoy)} l={`Patrimonio neto · ${netoHoy - hace12 >= 0 ? "+" : ""}${fmt(netoHoy - hace12)} vs hace 12 m`} />
          <Stat v={fmt(ahorro12)} l={`Ahorro neto últimos 12 m · ${fmt(ahorroProm)}/mes`} cls={ahorro12 >= 0 ? "pos" : "neg"} />
          <Stat v={pct(ahorro12, ing12)} l={`Tasa de ahorro · ingresos ${fmt(ing12)} / gastos ${fmt(gas12)}`} cls={tasaAhorro >= 0.2 ? "pos" : tasaAhorro >= 0 ? "" : "neg"} />
          <Stat v={fmt(gas3)} l={`Gasto mensual (prom. 3 m) · 12 m: ${fmt(gasProm12)} · ${gas3 > gasProm12 * 1.1 ? "↑ subiendo" : gas3 < gasProm12 * 0.9 ? "↓ bajando" : "estable"}`} cls={gas3 > gasProm12 * 1.1 ? "neg" : ""} />
        </div>
        <div className="stat-row" style={{ marginTop: 0 }}>
          <Stat v={fmt(efectivo - tarjetas)} l={`Liquidez (cheques − tarjetas) · ${runway === Infinity ? "—" : runway.toFixed(1) + " meses"} de gasto`} cls={runway < 2 ? "neg" : runway < 4 ? "" : "pos"} />
          <Stat v={fmt((nw?.retiro_inversion_mxn ?? 0))} l="Inversiones y retiro" />
          <Stat v={fmt(prestamos + tarjetas)} l={`Deuda total · ${d.deudas.length} préstamo${d.deudas.length === 1 ? "" : "s"} + tarjetas ${fmt(tarjetas)}`} cls={prestamos + tarjetas > 0 ? "neg" : "pos"} />
          <Stat v={d.akela ? pct(d.akela.real_ytd, d.akela.plan_ytd) : "—"} l={d.akela ? `Akela: real ${fmt(d.akela.real_ytd)} vs plan a la fecha ${fmt(d.akela.plan_ytd)} · fondo ${(d.akela.fondo_mxn / d.akela.plan_anual).toFixed(1)} años` : "Akela sin plan este año"} cls={d.akela && d.akela.real_ytd > d.akela.plan_ytd ? "neg" : "pos"} />
        </div>
      </div>

      {/* ---------- 2. flujo ---------- */}
      <h2>1 · Flujo de efectivo</h2>
      <div className="card">
        <div className="ct"><span>Ingresos vs gastos por mes</span><span className="tag">verde ingresos · rojo gastos · línea azul: ahorro acumulado (ingresos − gastos − abonos)</span></div>
        <FlujoChart meses={mesesR} ing={mesesR.map((m) => ingMes[idx(m)])} gas={mesesR.map((m) => gasMes[idx(m)] + deudaMes[idx(m)])} />
        <div className="tbl" style={{ marginTop: 10 }}><table style={{ fontSize: 12 }}>
          <thead><tr><th>Mes</th><th className="n">Ingresos</th><th className="n">Gastos</th><th className="n">Abonos deuda</th><th className="n">Ahorro / inversión</th><th className="n">Neto</th><th className="n">Tasa</th></tr></thead>
          <tbody>
            {mesesR.slice().reverse().map((m) => { const i = idx(m); const neto = ingMes[i] - gasMes[i] - deudaMes[i]; return (
              <tr key={m} style={m === ult ? { opacity: 0.6 } : undefined}><td>{mesLargo(m)}{m === ult ? " (en curso)" : ""}</td><td className="n">{fmt(ingMes[i])}</td><td className="n">{fmt(gasMes[i])}</td><td className="n">{deudaMes[i] ? fmt(deudaMes[i]) : "·"}</td><td className="n">{ahorroMes[i] ? fmt(ahorroMes[i]) : "·"}</td><td className={"n " + (neto >= 0 ? "pos" : "neg")} style={{ fontWeight: 700 }}>{fmt(neto)}</td><td className="n">{pct(neto, ingMes[i])}</td></tr>); })}
            <tr className="tot"><td>Últimos 12 m cerrados</td><td className="n">{fmt(ing12)}</td><td className="n">{fmt(gas12)}</td><td className="n">{fmt(sum(ult12.map((m) => deudaMes[idx(m)])))}</td><td className="n">{fmt(sum(ult12.map((m) => ahorroMes[idx(m)])))}</td><td className={"n " + (ahorro12 >= 0 ? "pos" : "neg")}>{fmt(ahorro12)}</td><td className="n">{pct(ahorro12, ing12)}</td></tr>
          </tbody>
        </table></div>
        <p className="hint">«Ahorro / inversión» son tus traspasos a inversión (ya están dentro del neto, no se restan dos veces). Si un mes tiene ingresos en cero es que aún no están registrados.</p>
      </div>

      {/* ---------- 3. patrimonio ---------- */}
      <h2>2 · Patrimonio</h2>
      <div className="card">
        <div className="ct"><span>Evolución y proyección</span><span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><label htmlFor="a-tasa" style={{ margin: 0 }}>rendimiento anual asumido</label><select id="a-tasa" value={tasaProy} onChange={(e) => setTasaProy(Number(e.target.value))}>{[0, 0.03, 0.05, 0.07, 0.1].map((t) => <option key={t} value={t}>{Math.round(t * 100)} %</option>)}</select></span></div>
        <PatrimonioChart meses={mesesR} neto={mesesR.map((m) => netoMes[idx(m)])} proy={proy}
          series={[{ nombre: "Inversiones", color: "var(--aho)", vals: mesesR.map((m) => invMes[idx(m)]) }, { nombre: "Retiro", color: "var(--nec)", vals: mesesR.map((m) => retMes[idx(m)]) }, { nombre: "Efectivo", color: "var(--gus)", vals: mesesR.map((m) => efeMes[idx(m)]) }, { nombre: "Deuda", color: "var(--deu)", vals: mesesR.map((m) => deuMes[idx(m)]) }]} />
        <div className="stat-row" style={{ marginTop: 8 }}>
          <Stat v={fmt(proy[11])} l={`En 12 meses, ahorrando ${fmt(ahorroProm)}/mes al ${Math.round(tasaProy * 100)} %`} />
          <Stat v={fmt(proy[11] - netoHoy)} l="Crecimiento proyectado" cls={proy[11] >= netoHoy ? "pos" : "neg"} />
          <Stat v={netoHoy > 0 && gas3 > 0 ? (netoHoy / (gas3 * 12)).toFixed(1) + " años" : "—"} l="Años de gasto cubiertos con el patrimonio neto (sin rendimiento)" />
        </div>
        <p className="hint">Inversiones = NAV IBKR fin de mes (USD al TC del mes); retiro = último saldo registrado (AFORE, PPR…); efectivo y deuda = saldo actual reconstruido hacia atrás con el flujo neto (aproximación). La línea negra es el neto; la punteada, la proyección.</p>
      </div>

      {/* ---------- 4. dónde se va ---------- */}
      <h2>3 · A dónde se va · últimos 12 meses cerrados</h2>
      <div className="g2">
        <div className="card">
          <div className="ct"><span>Necesidad · gusto · ahorro · deuda</span></div>
          <div className="dona-wrap">
            <svg viewBox="0 0 240 240" style={{ width: 200 }} role="img" aria-label="Clasificación del gasto">
              {(() => { const tot = sum(porCls.map((x) => x[1])) || 1; let a = 0; const R = 84, r = 54, cx = 120, cy = 120, rm = (R + r) / 2; return porCls.map(([c, v]) => { const f = v / tot; const a1 = a + f * 2 * Math.PI * 0.99999; const dd = `M${cx + rm * Math.sin(a)},${cy - rm * Math.cos(a)} A${rm},${rm} 0 ${a1 - a > Math.PI ? 1 : 0} 1 ${cx + rm * Math.sin(a1)},${cy - rm * Math.cos(a1)}`; a = a1; const key = Object.keys(CLS_LABEL).find((kk) => CLS_LABEL[kk] === c) ?? "N"; return <path key={c} d={dd} stroke={CLS_COLOR[key]} strokeWidth={R - r} fill="none"><title>{`${c} ${Math.round(f * 100)}%`}</title></path>; }); })()}
              <circle cx={120} cy={120} r={84} fill="none" stroke="var(--ink)" strokeWidth={2} /><circle cx={120} cy={120} r={54} fill="none" stroke="var(--ink)" strokeWidth={2} />
              <text x={120} y={116} textAnchor="middle" fontFamily="Fraunces,serif" fontSize={20} fontWeight={900} fill="var(--green-deep)">{pct(porCls.find((x) => x[0] === "Necesidad")?.[1] ?? 0, sum(porCls.map((x) => x[1])))}</text><text x={120} y={134} textAnchor="middle" fontSize={9.5} fill="var(--gray-soft)">necesidad</text>
            </svg>
            <div style={{ flex: 1, minWidth: 200 }}>
              {porCls.map(([c, v]) => { const key = Object.keys(CLS_LABEL).find((kk) => CLS_LABEL[kk] === c) ?? "N"; const tot = sum(porCls.map((x) => x[1])); return (
                <div key={c} className="catbar"><div className="lbl"><span>{c}</span><span>{fmt(v)} · {pct(v, tot)} · {fmt(v / 12)}/mes</span></div><div className="track"><div className="fill" style={{ width: `${(v / (porCls[0][1] || 1)) * 100}%`, background: CLS_COLOR[key] }} /></div></div>); })}
              <p className="hint" style={{ marginTop: 8 }}>Por libro: {porLibro.map(([l, v]) => `${l} ${fmt(v)}`).join(" · ")}.</p>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="ct"><span>Rubros · promedio 3 m vs 12 m</span><span className="tag">toca uno para ver subrubros</span></div>
          {grupos.slice(0, 12).map((g) => { const dif = g.prom12 ? (g.prom3 - g.prom12) / g.prom12 : 0; return (
            <div key={g.grupo} className={"catbar" + (selGrupo === g.grupo ? " on" : "")} role="button" tabIndex={0} onClick={() => setSelGrupo(selGrupo === g.grupo ? "" : g.grupo)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelGrupo(selGrupo === g.grupo ? "" : g.grupo); } }}>
              <div className="lbl"><span><i style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: color(g.grupo), border: "1.5px solid var(--ink)", verticalAlign: -1, marginRight: 6 }} />{g.grupo}</span><span>{fmt(g.prom12)}/mes <span className={Math.abs(dif) < 0.1 ? "hint" : dif > 0 ? "neg" : "pos"}>{dif > 0 ? "▲" : dif < 0 ? "▼" : "•"} {Math.round(Math.abs(dif) * 100)} % (3 m: {fmt(g.prom3)})</span></span></div>
              <div className="track"><div className="fill" style={{ width: `${(g.prom12 / (grupos[0]?.prom12 || 1)) * 100}%`, background: color(g.grupo) }} /><div className="mark" style={{ left: `${Math.min(100, (g.prom3 / (grupos[0]?.prom12 || 1)) * 100)}%` }} title={`promedio 3 m ${fmt(g.prom3)}`} /></div>
            </div>); })}
          {selGrupo && <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--bone)", borderRadius: 8 }}><b style={{ fontSize: 12 }}>{selGrupo} · 12 m</b>{subs.slice(0, 10).map(([r, v]) => <div key={r} className="catbar"><div className="lbl"><span>{r}</span><span>{fmt(v)} · {fmt(v / 12)}/mes</span></div><div className="track"><div className="fill" style={{ width: `${(v / (subs[0]?.[1] || 1)) * 100}%`, background: color(selGrupo) }} /></div></div>)}</div>}
        </div>
      </div>

      {/* ---------- 5. compromisos ---------- */}
      <h2>4 · Lo que viene · próximos 3 meses</h2>
      <div className="card">
        <div className="tbl"><table>
          <thead><tr><th>Mes</th><th className="n">Ya comprometido (MSI, cuotas)</th><th className="n">Presupuestado</th><th className="n">Pagos de deuda</th><th className="n">Akela (plan/mes)</th><th className="n">Total</th><th className="n">Ingreso promedio</th><th className="n">Margen</th></tr></thead>
          <tbody>
            {prox.map((m) => { const f = futPorMes(m); const com = sum(f.filter((x) => x.estado === "real").map((x) => x.monto_mxn)), pre = sum(f.filter((x) => x.estado === "presupuesto").map((x) => x.monto_mxn)), deu = deudaPagosMes(m); const tot = com + pre + deu + akelaMes + Math.max(0, gas3 - pre - com); const margen = ingProm - tot; return (
              <tr key={m}><td>{mesLargo(m)}</td><td className="n">{com ? fmt(com) : "·"}</td><td className="n">{pre ? fmt(pre) : "·"}</td><td className="n">{deu ? fmt(deu) : "·"}</td><td className="n">{akelaMes ? fmt(akelaMes) : "·"}</td><td className="n" style={{ fontWeight: 700 }} title="comprometido + presupuestado + deuda + Akela + gasto corriente estimado (prom. 3 m) no cubierto por lo anterior">{fmt(tot)}</td><td className="n">{fmt(ingProm)}</td><td className={"n " + (margen >= 0 ? "pos" : "neg")} style={{ fontWeight: 700 }}>{fmt(margen)}</td></tr>); })}
          </tbody>
        </table></div>
        <div className="g2" style={{ marginTop: 10 }}>
          <div>
            <div className="ct"><span>Meses sin intereses pendientes</span><span className="tag">{fmt(sum(msiPend.map((x) => x.monto_mxn)))} en {msiPend.length} cuotas</span></div>
            {msiPend.length === 0 ? <p className="hint">Sin cuotas a futuro.</p> : <div className="tbl"><table style={{ fontSize: 12 }}><tbody>{msiPend.slice(0, 20).map((x, i) => <tr key={i}><td>{x.fecha}</td><td style={{ whiteSpace: "normal" }}>{x.descripcion} <span className="hint">{x.notas}</span></td><td className="n">{fmt(x.monto_mxn)}</td></tr>)}</tbody></table></div>}
          </div>
          <div>
            <div className="ct"><span>Deudas</span><span className="tag">{fmt(prestamos)} + tarjetas {fmt(tarjetas)}</span></div>
            {d.deudas.length === 0 ? <p className="hint">Sin préstamos.</p> : <div className="tbl"><table style={{ fontSize: 12 }}>
              <thead><tr><th>Deuda</th><th className="n">Saldo</th><th className="n">Pago</th><th className="n">Restan</th><th>Se liquida</th><th className="n">Tasa</th></tr></thead>
              <tbody>{d.deudas.map((x) => <tr key={x.deuda}><td>{x.deuda}</td><td className="n">{x.moneda} {fmt(x.saldo_actual)}</td><td className="n">{x.proximo_pago_monto ? fmt(x.proximo_pago_monto) : "·"}</td><td className="n">{x.pagos_restantes ?? "·"}</td><td>{x.fecha_liquidacion ?? "·"}</td><td className="n">{x.tasa_anual != null ? (x.tasa_anual * 100).toFixed(1) + " %" : "·"}</td></tr>)}</tbody>
            </table></div>}
          </div>
        </div>
        <p className="hint">«Total» suma lo ya comprometido, lo presupuestado, los pagos de deuda, el plan Akela mensual y el gasto corriente estimado (promedio 3 m) que no esté ya en las columnas anteriores. Margen = ingreso promedio 12 m − total.</p>
      </div>

      {/* ---------- 6. composición ---------- */}
      <h2>5 · Composición del patrimonio</h2>
      <div className="card">
        <div className="dona-wrap">
          <Dona cats={comp} tot={compTot} sel={selCta} />
          <div style={{ flex: 1, minWidth: 260 }}>
            {comp.map(([c, v]) => { const ct = d.cuentas.find((x) => x.nombre === c); return (
              <div key={c} className={"catbar" + (selCta === c ? " on" : "")} role="button" tabIndex={0} onClick={() => setSelCta(selCta === c ? "" : c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelCta(selCta === c ? "" : c); } }}>
                <div className="lbl"><span><i style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: color(c), border: "1.5px solid var(--ink)", verticalAlign: -1, marginRight: 6 }} />{c} <span className="hint">{ct?.tipo}{ct?.moneda === "USD" ? ` · US$${Math.round(ct.saldo).toLocaleString("en-US")}` : ""}{ct?.fecha ? ` · ${ct.fecha}` : ""}</span></span><span>{fmt(v)} · {pct(v, compTot)}</span></div>
                <div className="track"><div className="fill" style={{ width: `${(v / (comp[0]?.[1] || 1)) * 100}%`, background: color(c) }} /></div>
              </div>); })}
            <p className="hint" style={{ marginTop: 8 }}>Activos {fmt(compTot)} − deuda {fmt(prestamos + tarjetas)} = neto {fmt(netoHoy)}. Liquidez inmediata: {pct(efectivo, compTot)} del activo.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
