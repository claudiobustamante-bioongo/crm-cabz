"use client";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/format";

/** Proyección del net worth de cuentas propias a N años (plazo editable, 20 por omisión) con el ahorro actual y variaciones de ±10/15/20 %.
 *  Interés compuesto mensual: cada mes el saldo rinde r/12 y se suma 1/12 del ahorro anual. */
type Props = { netoHoy: number; ingresos12: number; gastos12: number; deuda12: number; desde: string; hasta: string };

const PLAZO = 20;
const ESPERADO = 1_300_000, MINIMO = 480_000;   // ahorro anual de los próximos años (definido por Claudio, nov 2026)
const MIN = -1;                                 // clave del escenario «mínimo»
const ESCENARIOS: { v: number; color: string; dash?: string; ancho: number }[] = [
  { v: 0.2, color: "#2F6B40", ancho: 1.6 },
  { v: 0.15, color: "#4F8A5E", ancho: 1.4 },
  { v: 0.1, color: "#7DAE89", ancho: 1.3 },
  { v: 0, color: "var(--ink)", ancho: 3 },
  { v: -0.1, color: "#C98A5B", dash: "5 4", ancho: 1.3 },
  { v: -0.15, color: "#B4683F", dash: "5 4", ancho: 1.4 },
  { v: -0.2, color: "#A04634", dash: "5 4", ancho: 1.6 },
];
const etiqueta = (v: number) => (v === MIN ? "Mínimo" : v === 0 ? "Esperado" : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)} %`);
const corto = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`; };

export function ProyeccionNW({ netoHoy, ingresos12, gastos12, deuda12, desde, hasta }: Props) {
  const historico = Math.round(ingresos12 - gastos12 - deuda12);
  const [ahorro, setAhorro] = useState(ESPERADO);
  const [minimo, setMinimo] = useState(MINIMO);
  const [tasa, setTasa] = useState(6);
  const [inflacion, setInflacion] = useState(4);
  const [real, setReal] = useState(false);
  const [conRend, setConRend] = useState(true);
  const [ocultas, setOcultas] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [plazoTxt, setPlazoTxt] = useState(String(PLAZO));
  const ANIOS = Math.min(50, Math.max(1, Math.round(Number(plazoTxt)) || PLAZO));

  const series = useMemo(() => [...ESCENARIOS, { v: MIN, color: "#6B6760", dash: "2 4", ancho: 2 }].map((e) => {
    const anual = e.v === MIN ? minimo : ahorro * (1 + e.v);
    const r = conRend ? tasa / 100 / 12 : 0, inf = inflacion / 100;
    const pts: number[] = [netoHoy]; let v = netoHoy;
    for (let a = 1; a <= ANIOS; a++) { for (let m = 0; m < 12; m++) v = v * (1 + r) + anual / 12; pts.push(real ? v / Math.pow(1 + inf, a) : v); }
    return { ...e, anual, pts };
  }), [ahorro, minimo, tasa, conRend, inflacion, real, netoHoy, ANIOS]);

  const visibles = series.filter((s) => !ocultas.has(s.v));
  const W = 760, H = 330, L = 64, R = 16, T = 14, B = 30;
  const todos = visibles.flatMap((s) => s.pts);
  const yMax = Math.max(1, ...todos), yMin = Math.min(0, ...todos);
  const paso = (() => { const rango = yMax - yMin; const p = Math.pow(10, Math.floor(Math.log10(rango / 5))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => rango / k <= 6) ?? p * 10; })();
  const top = Math.ceil(yMax / paso) * paso, bot = Math.floor(yMin / paso) * paso;
  const x = (a: number) => L + (a / ANIOS) * (W - L - R);
  const y = (v: number) => T + (1 - (v - bot) / (top - bot || 1)) * (H - T - B);
  const ticks: number[] = []; for (let t = bot; t <= top + 1e-6; t += paso) ticks.push(t);
  const anioHoy = new Date().getFullYear();
  const base = series.find((s) => s.v === 0)!;
  const hitos = [...new Set([1, ...[0.25, 0.5, 0.75].map((f) => Math.round(ANIOS * f)), ANIOS])].filter((a) => a >= 1 && a <= ANIOS).sort((a, b) => a - b);
  const pasoX = ANIOS <= 10 ? 1 : ANIOS <= 20 ? 5 : ANIOS <= 40 ? 10 : 10;
  const ticksX = Array.from({ length: Math.floor(ANIOS / pasoX) + 1 }, (_, i) => i * pasoX).concat(ANIOS % pasoX ? [ANIOS] : []);

  return (
    <div className="card">
      <div className="ct"><span>Proyección de tu net worth · {ANIOS} año{ANIOS > 1 ? "s" : ""} <span className="hint" style={{ fontWeight: 400 }}>· {real ? `real (pesos de hoy, inflación ${inflacion} %)` : "nominal"} · {conRend ? `rendimiento ${tasa} %` : "sin rendimiento"}</span></span><span className="tag">cuentas propias · hoy {fmt(netoHoy)}</span></div>
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 6 }}>
        <div><label htmlFor="p-ah">Ahorro anual esperado</label><input id="p-ah" type="number" step={10000} value={ahorro} onChange={(e) => setAhorro(Number(e.target.value))} />
          <div className="hint" style={{ fontSize: 11 }}>{fmt(ahorro / 12)}/mes{ahorro !== ESPERADO ? <> · <button type="button" className="link" onClick={() => setAhorro(ESPERADO)}>volver a {fmt(ESPERADO)}</button></> : null}</div></div>
        <div><label htmlFor="p-min">Ahorro anual mínimo</label><input id="p-min" type="number" step={10000} value={minimo} onChange={(e) => setMinimo(Number(e.target.value))} />
          <div className="hint" style={{ fontSize: 11 }}>{fmt(minimo / 12)}/mes · piso</div></div>
        <div><label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={conRend} onChange={(e) => setConRend(e.target.checked)} style={{ width: "auto" }} /> Rendimiento esperado</label>
          <input id="p-r" type="number" step={0.5} value={tasa} onChange={(e) => setTasa(Number(e.target.value))} disabled={!conRend} aria-label="Rendimiento anual %" />
          <div className="hint" style={{ fontSize: 11 }}>{conRend ? "% anual nominal sobre todo el neto" : "sin rendimiento: solo lo ahorrado"}</div></div>
        <div><label htmlFor="p-plazo">Plazo (años)</label><input id="p-plazo" type="number" min={1} max={50} step={1} value={plazoTxt} onChange={(e) => { setPlazoTxt(e.target.value); setHover(null); }} />
          <div className="pills" style={{ margin: "4px 0 0" }}>{[5, 10, 20, 30].map((n) => <button key={n} type="button" className="pill" aria-pressed={ANIOS === n} onClick={() => { setPlazoTxt(String(n)); setHover(null); }} style={{ padding: "1px 8px", fontSize: 11 }}>{n}</button>)}</div></div>
        <div><label>Valores</label>
          <div className="pills" style={{ margin: "2px 0 0" }}>
            <button type="button" className="pill" aria-pressed={!real} onClick={() => setReal(false)}>Nominal</button>
            <button type="button" className="pill" aria-pressed={real} onClick={() => setReal(true)}>Real</button>
          </div>
          {real && <div className="hint" style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>pesos de hoy · inflación <input id="p-i" type="number" step={0.5} value={inflacion} onChange={(e) => setInflacion(Number(e.target.value))} style={{ width: 56, padding: "2px 6px" }} aria-label="Inflación anual %" /> %</div>}</div>
      </div>

      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Proyección de net worth a ${ANIOS} años por escenario de ahorro`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const a = Math.round(((px - L) / (W - L - R)) * ANIOS); setHover(a >= 0 && a <= ANIOS ? a : null); }}>
          {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--gray-soft)" : "var(--border-soft)"} strokeWidth={t === 0 ? 1 : 0.7} /><text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={11} fill="var(--gray-soft)">{corto(t)}</text></g>)}
          {ticksX.map((a) => <text key={a} x={x(a)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--gray-soft)">{a === 0 ? "hoy" : anioHoy + a}</text>)}
          {visibles.map((s) => <polyline key={s.v} fill="none" stroke={s.color} strokeWidth={s.ancho} strokeDasharray={s.dash} strokeLinejoin="round" points={s.pts.map((v, a) => `${x(a)},${y(v)}`).join(" ")} />)}
          <text x={x(ANIOS) - 4} y={y(base.pts[ANIOS]) + 16} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--ink)" style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 4 }}>{corto(base.pts[ANIOS])}</text>
          {hover != null && <><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--gray-soft)" strokeDasharray="3 3" />
            {visibles.map((s) => <circle key={"c" + s.v} cx={x(hover)} cy={y(s.pts[hover])} r={s.v === 0 ? 4 : 3} fill={s.color} stroke="var(--paper)" strokeWidth={1.5} />)}</>}
        </svg>
        {hover != null && <div style={{ position: "absolute", top: 10, [hover > ANIOS / 2 ? "left" : "right"]: 70, background: "var(--paper)", border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 10px", fontSize: 12, boxShadow: "0 6px 18px rgba(0,0,0,.08)", pointerEvents: "none", minWidth: 190 }}>
          <b>{hover === 0 ? "Hoy" : `${anioHoy + hover} · año ${hover}`}</b>
          {visibles.map((s) => <div key={s.v} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: s.v === 0 ? 700 : 400 }}><span style={{ color: s.color }}>{etiqueta(s.v)}</span><span>{fmt(s.pts[hover])}</span></div>)}
        </div>}
      </div>

      <div className="pills" style={{ marginTop: 6 }}>
        {series.map((s) => <button key={s.v} type="button" className="pill" aria-pressed={!ocultas.has(s.v)} title={`${fmt(s.anual)}/año`} onClick={() => { const n = new Set(ocultas); if (n.has(s.v)) n.delete(s.v); else if (s.v !== 0) n.add(s.v); setOcultas(n); }}>
          <i style={{ display: "inline-block", width: 14, height: 0, borderTop: `${Math.max(2, s.ancho)}px ${s.dash ? "dashed" : "solid"} ${s.color}`, marginRight: 6, verticalAlign: 3 }} />{etiqueta(s.v)} · {corto(s.anual)}/año
        </button>)}
      </div>

      <div className="tbl" style={{ marginTop: 8 }}><table>
        <thead><tr><th>Escenario</th><th className="n">Ahorro/año</th>{hitos.map((a) => <th key={a} className="n">{a} año{a > 1 ? "s" : ""}<div className="hint" style={{ fontWeight: 400 }}>{anioHoy + a}</div></th>)}</tr></thead>
        <tbody>{series.map((s) => <tr key={s.v} className={s.v === 0 ? "tot" : ""}><td><span style={{ color: s.color, fontWeight: 700 }}>●</span> {etiqueta(s.v)}</td><td className="n">{fmt(s.anual)}</td>
          {hitos.map((a) => <td key={a} className="n" title={s.v === 0 ? undefined : `${s.pts[a] >= base.pts[a] ? "+" : "−"}${fmt(Math.abs(s.pts[a] - base.pts[a]))} vs esperado`}>{fmt(s.pts[a])}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="hint">Esperado {fmt(ESPERADO)} y mínimo {fmt(MINIMO)} al año son tus metas; las variaciones ± se aplican sobre el esperado. Referencia histórica (12 meses, {desde} a {hasta}): ingresos {fmt(ingresos12)} − gastos que pagas tú {fmt(gastos12)} − abonos a deuda {fmt(deuda12)} = <b>{fmt(historico)}</b>. {conRend ? `Rendimiento ${tasa} % anual compuesto mensual sobre todo el neto (incluye efectivo)` : "Sin rendimiento: el neto solo crece con lo que ahorras"}; ahorro constante en pesos {real ? `y valores deflactados al ${inflacion} % anual (pesos de hoy)` : "nominales (sin descontar inflación)"}. Sin impuestos ni cambios de ingreso.</p>
    </div>
  );
}
