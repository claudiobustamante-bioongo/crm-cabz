"use client";
import { useMemo, useState, type ReactNode } from "react";
import { fmt } from "@/lib/format";

/** Proyección de un saldo a N años con aportación anual esperada (±10/15/20 %) y una línea de mínimo.
 *  Interés compuesto mensual: cada mes el saldo rinde r/12 y se suma 1/12 de (aportación − retiros).
 *  Sumas adicionales: montos únicos que entran al inicio del año indicado. Se usa en Inversiones (net worth) y en Akela (fondo). */
export type ProyeccionProps = {
  titulo: string;                                   // «Proyección de tu net worth», «Proyección del Fondo Akela»
  tag: ReactNode;                                   // a la derecha del título
  inicial: number;                                  // saldo de arranque (MXN)
  aportes: { label: string; def: number; hint?: string }[];   // se suman para el escenario esperado
  minimo: { label: string; def: number; hint?: string };
  conRetiros?: { def: number; hint?: string };      // retiros anuales del saldo (se restan en todos los escenarios); opcionalmente crecen con la inflación
  conExtras?: boolean;                              // tabla de sumas adicionales (año, monto)
  nota?: ReactNode;                                 // texto al pie (referencia histórica)
  id: string;                                       // prefijo único para los id de los inputs
};

const PLAZO = 20, MIN = -1, UNICA = 99;   // claves: escenario mínimo y «esperado + aportación única»
const ESCENARIOS: { v: number; color: string; dash?: string; ancho: number }[] = [
  { v: 0.2, color: "#2F6B40", ancho: 1.6 },
  { v: 0.15, color: "#4F8A5E", ancho: 1.4 },
  { v: 0.1, color: "#7DAE89", ancho: 1.3 },
  { v: 0, color: "var(--ink)", ancho: 3 },
  { v: -0.1, color: "#C98A5B", dash: "5 4", ancho: 1.3 },
  { v: -0.15, color: "#B4683F", dash: "5 4", ancho: 1.4 },
  { v: -0.2, color: "#A04634", dash: "5 4", ancho: 1.6 },
];
const corto = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}k` : `${s}$${Math.round(a)}`; };

export function Proyeccion({ titulo, tag, inicial, aportes, minimo, conRetiros, conExtras, nota, id }: ProyeccionProps) {
  const anioHoy = new Date().getFullYear();
  const [ap, setAp] = useState(aportes.map((a) => a.def));
  const [minV, setMinV] = useState(minimo.def);
  const [ret, setRet] = useState(conRetiros?.def ?? 0);
  const [indexar, setIndexar] = useState(true);       // retiros crecen con la inflación (en términos reales quedan constantes)
  const [extras, setExtras] = useState<{ anio: string; monto: string; nota: string }[]>([{ anio: String(anioHoy + 1), monto: "", nota: "" }]);
  const [modoUnica, setModoUnica] = useState<"comparar" | "todos">("comparar");   // comparar = línea aparte; todos = se suma a cada escenario
  const [tasa, setTasa] = useState(6);
  const [conRend, setConRend] = useState(true);
  const [inflacion, setInflacion] = useState(4);
  const [real, setReal] = useState(false);
  const [plazoTxt, setPlazoTxt] = useState(String(PLAZO));
  const [ocultas, setOcultas] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const ANIOS = Math.min(50, Math.max(1, Math.round(Number(plazoTxt)) || PLAZO));
  const esperado = ap.reduce((a, b) => a + (Number(b) || 0), 0);
  const etiqueta = (v: number) => (v === UNICA ? "Esperado + única" : v === MIN ? minimo.label : v === 0 ? "Esperado" : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)} %`);

  // aportaciones únicas por índice de año: el año siguiente al actual (o el actual) = 1, entra al inicio del primer año proyectado
  const extraPorAnio = useMemo(() => {
    const m = new Map<number, number>();
    extras.forEach((e) => { const a = Math.max(1, (Number(e.anio) || 0) - anioHoy), v = Number(e.monto) || 0; if (v && a <= 50) m.set(a, (m.get(a) ?? 0) + v); });
    return m;
  }, [extras, anioHoy]);

  const totExtras = [...extraPorAnio.values()].reduce((a, b) => a + b, 0);
  const series = useMemo(() => {
    const sim = (anual: number, ext: Map<number, number>) => {
      const r = conRend ? tasa / 100 / 12 : 0, inf = inflacion / 100;
      const pts: number[] = [inicial]; let v = inicial;
      for (let a = 1; a <= ANIOS; a++) {
        const retA = ret * (indexar ? Math.pow(1 + inf, a - 1) : 1), neto = anual - retA;   // año 1 = monto de hoy; después crece con la inflación
        v += ext.get(a) ?? 0; for (let m = 0; m < 12; m++) v = v * (1 + r) + neto / 12; pts.push(real ? v / Math.pow(1 + inf, a) : v);
      }
      return { pts, agota: pts.findIndex((p, i) => i > 0 && p <= 0) };
    };
    const extTodos = modoUnica === "todos" ? extraPorAnio : new Map<number, number>();
    const out = [...ESCENARIOS, { v: MIN, color: "#6B6760", dash: "2 4", ancho: 2 }].map((e) => { const anual = e.v === MIN ? minV : esperado * (1 + e.v); return { ...e, anual, ...sim(anual, extTodos) }; });
    if (modoUnica === "comparar" && totExtras !== 0) out.splice(0, 0, { v: UNICA, color: "#B8924D", ancho: 3.4, dash: undefined, anual: esperado, ...sim(esperado, extraPorAnio) });
    return out;
  }, [esperado, minV, ret, indexar, tasa, conRend, inflacion, real, inicial, ANIOS, extraPorAnio, modoUnica, totExtras]);

  const visibles = series.filter((s) => !ocultas.has(s.v));
  const W = 760, H = 330, L = 64, R = 16, T = 14, B = 30;
  const todos = visibles.flatMap((s) => s.pts);
  const yMax = Math.max(1, ...todos), yMin = Math.min(0, ...todos);
  const paso = (() => { const rango = yMax - yMin; const p = Math.pow(10, Math.floor(Math.log10(rango / 5))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => rango / k <= 6) ?? p * 10; })();
  const top = Math.ceil(yMax / paso) * paso, bot = Math.floor(yMin / paso) * paso;
  const x = (a: number) => L + (a / ANIOS) * (W - L - R);
  const y = (v: number) => T + (1 - (v - bot) / (top - bot || 1)) * (H - T - B);
  const ticks: number[] = []; for (let t = bot; t <= top + 1e-6; t += paso) ticks.push(t);
  const base = series.find((s) => s.v === 0)!;
  const hitos = [...new Set([1, ...[0.25, 0.5, 0.75].map((f) => Math.round(ANIOS * f)), ANIOS])].filter((a) => a >= 1 && a <= ANIOS).sort((a, b) => a - b);
  const pasoX = ANIOS <= 10 ? 1 : ANIOS <= 20 ? 5 : 10;
  const ticksX = Array.from({ length: Math.floor(ANIOS / pasoX) + 1 }, (_, i) => i * pasoX).concat(ANIOS % pasoX ? [ANIOS] : []);
  const unica = series.find((s) => s.v === UNICA);

  return (
    <div className="card">
      <div className="ct"><span>{titulo} · {ANIOS} año{ANIOS > 1 ? "s" : ""} <span className="hint" style={{ fontWeight: 400 }}>· {real ? `real (pesos de hoy, inflación ${inflacion} %)` : "nominal"} · {conRend ? `rendimiento ${tasa} %` : "sin rendimiento"}</span></span><span className="tag">{tag}</span></div>
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 6 }}>
        {aportes.map((a, i) => <div key={i}><label htmlFor={`${id}-ap${i}`}>{a.label}</label><input id={`${id}-ap${i}`} type="number" step={10000} value={ap[i]} onChange={(e) => setAp(ap.map((x, j) => (j === i ? Number(e.target.value) : x)))} />
          <div className="hint" style={{ fontSize: 11 }}>{fmt(ap[i] / 12)}/mes{ap[i] !== a.def ? <> · <button type="button" className="link" onClick={() => setAp(ap.map((x, j) => (j === i ? a.def : x)))}>volver a {fmt(a.def)}</button></> : a.hint ? ` · ${a.hint}` : null}</div></div>)}
        <div><label htmlFor={`${id}-min`}>{minimo.label}</label><input id={`${id}-min`} type="number" step={10000} value={minV} onChange={(e) => setMinV(Number(e.target.value))} />
          <div className="hint" style={{ fontSize: 11 }}>{fmt(minV / 12)}/mes · {minimo.hint ?? "piso"}</div></div>
        {conRetiros && <div><label htmlFor={`${id}-ret`}>Retiros anuales (hoy)</label><input id={`${id}-ret`} type="number" step={10000} value={ret} onChange={(e) => setRet(Number(e.target.value))} />
          <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0 0", fontWeight: 400, fontSize: 11.5 }}><input type="checkbox" checked={indexar} onChange={(e) => setIndexar(e.target.checked)} style={{ width: "auto" }} /> crecen con la inflación</label>
          <div className="hint" style={{ fontSize: 11 }}>{ret !== conRetiros.def ? <><button type="button" className="link" onClick={() => setRet(conRetiros.def)}>volver a {fmt(conRetiros.def)}</button> · </> : null}{conRetiros.hint ?? "se restan en todos los escenarios"}</div></div>}
        <div><label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={conRend} onChange={(e) => setConRend(e.target.checked)} style={{ width: "auto" }} /> Rendimiento esperado</label>
          <input type="number" step={0.5} value={tasa} onChange={(e) => setTasa(Number(e.target.value))} disabled={!conRend} aria-label="Rendimiento anual %" />
          <div className="hint" style={{ fontSize: 11 }}>{conRend ? "% anual sobre todo el saldo" : "sin rendimiento: solo lo aportado"}</div></div>
        <div><label htmlFor={`${id}-plazo`}>Plazo (años)</label><input id={`${id}-plazo`} type="number" min={1} max={50} step={1} value={plazoTxt} onChange={(e) => { setPlazoTxt(e.target.value); setHover(null); }} />
          <div className="pills" style={{ margin: "4px 0 0" }}>{[5, 10, 20, 30].map((n) => <button key={n} type="button" className="pill" aria-pressed={ANIOS === n} onClick={() => { setPlazoTxt(String(n)); setHover(null); }} style={{ padding: "1px 8px", fontSize: 11 }}>{n}</button>)}</div></div>
        <div><label>Valores</label>
          <div className="pills" style={{ margin: "2px 0 0" }}>
            <button type="button" className="pill" aria-pressed={!real} onClick={() => setReal(false)}>Nominal</button>
            <button type="button" className="pill" aria-pressed={real} onClick={() => setReal(true)}>Real</button>
          </div>
          {(real || (!!conRetiros && indexar && ret !== 0)) && <div className="hint" style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>{real ? "pesos de hoy · " : ""}inflación <input type="number" step={0.5} value={inflacion} onChange={(e) => setInflacion(Number(e.target.value))} style={{ width: 56, padding: "2px 6px" }} aria-label="Inflación anual %" /> %</div>}</div>
      </div>

      {conExtras && <div style={{ margin: "2px 0 10px", padding: "8px 10px", background: "var(--bone)", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><b style={{ fontSize: 13 }}>Aportación única (lump sum)</b><span className="hint">monto que entra al inicio del año indicado{totExtras ? ` · total ${fmt(totExtras)}` : ""}</span>
          <span className="pills" style={{ margin: 0 }}><button type="button" className="pill" aria-pressed={modoUnica === "comparar"} onClick={() => setModoUnica("comparar")} style={{ padding: "1px 8px", fontSize: 11 }}>comparar vs esperado</button><button type="button" className="pill" aria-pressed={modoUnica === "todos"} onClick={() => setModoUnica("todos")} style={{ padding: "1px 8px", fontSize: 11 }}>sumar a todos los escenarios</button></span>
          <button type="button" className="link" onClick={() => setExtras([...extras, { anio: String(anioHoy + 1), monto: "", nota: "" }])}>+ otra</button></div>
        {extras.map((e, i) => <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
          <input type="number" value={e.anio} min={anioHoy} max={anioHoy + 50} onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, anio: ev.target.value } : x)))} style={{ width: 90 }} aria-label="Año" />
          <input type="number" value={e.monto} step={500000} placeholder="monto, p. ej. 8000000 (− = retiro único)" onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, monto: ev.target.value } : x)))} style={{ width: 170 }} aria-label="Monto" />
          <input type="text" value={e.nota} placeholder="nota (venta, herencia, bono…)" onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, nota: ev.target.value } : x)))} style={{ flex: 1, minWidth: 140 }} aria-label="Nota" />
          <button type="button" className="del" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>✕</button>
        </div>)}
        {unica && (() => { const fin = unica.pts[ANIOS], sin = base.pts[ANIOS], dif = fin - sin; return (
          <div style={{ marginTop: 8, fontSize: 13 }}>Con <b>{fmt(totExtras)}</b> ({extras.filter((e) => Number(e.monto)).map((e) => `${fmt(Number(e.monto))} en ${e.anio}`).join(" + ")}): en {anioHoy + ANIOS} llegas a <b style={{ color: "#8C6D38" }}>{fmt(fin)}</b> vs {fmt(sin)} sin ella → <b className={dif >= 0 ? "pos" : "neg"}>{dif >= 0 ? "+" : "−"}{fmt(Math.abs(dif))}</b>{totExtras > 0 && dif > 0 ? <span className="hint"> (cada peso aportado vale {(dif / totExtras).toFixed(2)} al final{real ? ", en pesos de hoy" : ""})</span> : null}
            {base.agota > 0 && (unica.agota < 0 || unica.agota > base.agota) ? <span> · el fondo {unica.agota < 0 ? "ya no se agota" : `se agota en ${anioHoy + unica.agota} en vez de ${anioHoy + base.agota}`}</span> : null}.</div>); })()}
      </div>}

      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`${titulo} a ${ANIOS} años por escenario`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const a = Math.round(((px - L) / (W - L - R)) * ANIOS); setHover(a >= 0 && a <= ANIOS ? a : null); }}>
          {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--gray-soft)" : "var(--border-soft)"} strokeWidth={t === 0 ? 1 : 0.7} /><text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={11} fill="var(--gray-soft)">{corto(t)}</text></g>)}
          {ticksX.map((a) => <text key={a} x={x(a)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--gray-soft)">{a === 0 ? "hoy" : anioHoy + a}</text>)}
          {[...extraPorAnio.keys()].filter((a) => a <= ANIOS).map((a) => <line key={"e" + a} x1={x(a - 1)} x2={x(a - 1)} y1={T} y2={H - B} stroke="var(--gold)" strokeDasharray="2 3" opacity={0.7} />)}
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
        <thead><tr><th>Escenario</th><th className="n">Aporte/año</th>{hitos.map((a) => <th key={a} className="n">{a} año{a > 1 ? "s" : ""}<div className="hint" style={{ fontWeight: 400 }}>{anioHoy + a}</div></th>)}</tr></thead>
        <tbody>{series.map((s) => <tr key={s.v} className={s.v === 0 ? "tot" : ""}><td><span style={{ color: s.color, fontWeight: 700 }}>●</span> {etiqueta(s.v)}{s.agota > 0 && s.agota <= ANIOS ? <span className="neg" style={{ fontSize: 11 }}> · se agota en {anioHoy + s.agota}</span> : null}</td><td className="n">{fmt(s.anual)}</td>
          {hitos.map((a) => <td key={a} className={"n" + (s.pts[a] < 0 ? " neg" : "")} title={s.v === 0 ? undefined : `${s.pts[a] >= base.pts[a] ? "+" : "−"}${fmt(Math.abs(s.pts[a] - base.pts[a]))} vs esperado`}>{fmt(s.pts[a])}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="hint">Las variaciones ± se aplican sobre el esperado ({fmt(esperado)}/año{aportes.length > 1 ? ` = ${aportes.map((a, i) => `${a.label.toLowerCase()} ${fmt(ap[i])}`).join(" + ")}` : ""}). {conRend ? `Rendimiento ${tasa} % anual compuesto mensual sobre todo el saldo` : "Sin rendimiento: el saldo solo crece con lo aportado"}{ret ? `; retiros de ${fmt(ret)}/año ${indexar ? `que crecen ${inflacion} % al año (constantes en términos reales; en ${anioHoy + ANIOS} serán ${fmt(ret * Math.pow(1 + inflacion / 100, ANIOS - 1))} nominales)` : "fijos en pesos nominales"}, en todos los escenarios` : ""}; montos constantes en pesos {real ? `y valores deflactados al ${inflacion} % anual (pesos de hoy)` : "nominales (sin descontar inflación)"}. Sin impuestos. {nota}</p>
    </div>
  );
}
