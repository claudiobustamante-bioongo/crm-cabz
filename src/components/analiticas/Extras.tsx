"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AnaliticasData, MetaAhorro } from "@/lib/types";
import { fmt } from "@/lib/format";
import { isrAnual, TOPE_DEDUCCIONES_UMA, UMA_DIARIA, DED_LABEL } from "@/lib/contab";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + " %" : "—");
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/* =====================================================================
   Metas de ahorro
   ===================================================================== */
export function metaProgreso(m: MetaAhorro, d: AnaliticasData) {
  const cta = d.cuentasDestino.find((c) => c.id === m.cuenta_id)?.nombre ?? null;
  const hoyM = d.hoy.slice(0, 7), anio = d.hoy.slice(0, 4);
  const de = (f: (a: AnaliticasData["ahorros"][number]) => boolean) => sum(d.ahorros.filter((a) => (cta ? a.cuenta_destino === cta : true) && f(a)).map((a) => a.monto_mxn));
  const mesAct = +d.hoy.slice(5, 7);
  if (m.periodo === "mes") {
    const real = de((a) => a.mes === hoyM), ytd = de((a) => a.mes.startsWith(anio));
    const ultimos = Array.from({ length: 6 }, (_, i) => { const dt = new Date(Date.UTC(+anio, mesAct - 1 - i, 1)); const k = dt.toISOString().slice(0, 7); return { mes: k, real: de((a) => a.mes === k) }; }).reverse();
    return { cta, real, meta: m.monto, ytd, metaYtd: m.monto * mesAct, ultimos, etiqueta: "este mes" };
  }
  const ytd = de((a) => a.mes.startsWith(anio));
  return { cta, real: ytd, meta: m.monto, ytd, metaYtd: (m.monto * mesAct) / 12, ultimos: [], etiqueta: `en ${anio}` };
}

export function Metas({ d }: { d: AnaliticasData }) {
  const router = useRouter(); const supabase = createClient();
  const [metas, setMetas] = useState(d.metas);
  const [nueva, setNueva] = useState<{ nombre: string; monto: string; periodo: "mes" | "anio"; cuenta_id: string } | null>(null);
  const [msg, setMsg] = useState("");
  const guardar = async () => {
    if (!nueva || !nueva.nombre.trim() || !(Number(nueva.monto) > 0)) return setMsg("Nombre y monto.");
    const { data, error } = await supabase.from("metas_ahorro").insert({ nombre: nueva.nombre.trim(), monto: Number(nueva.monto), periodo: nueva.periodo, cuenta_id: nueva.cuenta_id || null, orden: metas.length }).select("*").single();
    if (error) return setMsg("No se guardó: " + error.message + (/metas_ahorro/.test(error.message) ? " (corre 47_metas_ahorro.sql)" : ""));
    setMetas([...metas, data as MetaAhorro]); setNueva(null); setMsg(""); router.refresh();
  };
  const editar = async (m: MetaAhorro, patch: Partial<MetaAhorro>) => {
    const { error } = await supabase.from("metas_ahorro").update(patch).eq("id", m.id);
    if (error) return setMsg("No se guardó: " + error.message);
    setMetas(metas.map((x) => (x.id === m.id ? { ...x, ...patch } : x)).filter((x) => x.activa)); router.refresh();
  };
  const totalMes = sum(metas.map((m) => (m.periodo === "mes" ? m.monto : m.monto / 12)));
  return (
    <div className="card">
      <div className="ct"><span>Metas de ahorro</span><span className="tag">{fmt(totalMes)}/mes en total · {fmt(totalMes * 12)}/año</span></div>
      {metas.length === 0 && !nueva && <p className="hint">Sin metas. Ejemplo: 50,000/mes a Bioongo y 220,000/año al PPR. El avance se mide con los movimientos de tipo «ahorro» hacia la cuenta destino.</p>}
      {metas.map((m) => { const p = metaProgreso(m, d); const ok = p.real >= p.meta; const ritmo = p.ytd >= p.metaYtd; return (
        <div key={m.id} className="catbar" style={{ cursor: "default" }}>
          <div className="lbl">
            <span><input type="text" defaultValue={m.nombre} onBlur={(e) => e.target.value.trim() && e.target.value !== m.nombre && editar(m, { nombre: e.target.value.trim() })} style={{ width: 130, fontWeight: 700 }} /> <span className="hint">→ {p.cta ?? "cualquier cuenta"} · <input type="number" defaultValue={m.monto} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== m.monto && editar(m, { monto: Number(e.target.value) })} style={{ width: 100 }} /> / {m.periodo === "mes" ? "mes" : "año"}</span></span>
            <span className={ok ? "pos" : ""}>{fmt(p.real)} {p.etiqueta} · {pct(p.real, p.meta)} <button className="del" type="button" title="Quitar meta" onClick={() => confirm(`¿Quitar la meta ${m.nombre}?`) && editar(m, { activa: false })}>✕</button></span>
          </div>
          <div className="track"><div className="fill" style={{ width: `${clamp(p.real / p.meta) * 100}%`, background: ok ? "var(--pos)" : "var(--gold)" }} /></div>
          <div className="hint" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>Acumulado {d.hoy.slice(0, 4)}: {fmt(p.ytd)} vs {fmt(p.metaYtd)} esperado a la fecha · <b className={ritmo ? "pos" : "neg"}>{ritmo ? "en ritmo" : `faltan ${fmt(p.metaYtd - p.ytd)}`}</b></span>
            {p.ultimos.length > 0 && <span>{p.ultimos.map((u) => <span key={u.mes} title={u.mes} style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, marginLeft: 3, background: u.real >= m.monto ? "var(--pos)" : u.real > 0 ? "var(--gold)" : "var(--cream)" }} />)}</span>}
          </div>
        </div>); })}
      {nueva ? <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
        <div><label style={{ margin: "0 0 2px" }}>Meta</label><input type="text" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Bioongo" style={{ width: 140 }} /></div>
        <div><label style={{ margin: "0 0 2px" }}>Monto</label><input type="number" value={nueva.monto} onChange={(e) => setNueva({ ...nueva, monto: e.target.value })} style={{ width: 110 }} /></div>
        <div><label style={{ margin: "0 0 2px" }}>Por</label><select value={nueva.periodo} onChange={(e) => setNueva({ ...nueva, periodo: e.target.value as "mes" | "anio" })}><option value="mes">mes</option><option value="anio">año</option></select></div>
        <div><label style={{ margin: "0 0 2px" }}>Cuenta destino</label><select value={nueva.cuenta_id} onChange={(e) => setNueva({ ...nueva, cuenta_id: e.target.value })}><option value="">cualquiera</option>{d.cuentasDestino.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
        <button className="btn sm" type="button" onClick={guardar}>Guardar</button><button className="link" type="button" onClick={() => setNueva(null)}>cancelar</button>
      </div> : <div className="center" style={{ marginTop: 8 }}><button className="btn ghost sm" type="button" onClick={() => setNueva({ nombre: "", monto: "", periodo: "mes", cuenta_id: d.cuentasDestino[0]?.id ?? "" })}>+ meta</button></div>}
      {msg && <div className="err" role="alert">{msg}</div>}
    </div>
  );
}

/* =====================================================================
   Proyección 1 / 5 / 10 años (tú y el fondo Akela)
   ===================================================================== */
export function Proyeccion({ d, netoHoy, ahorroProm }: { d: AnaliticasData; netoHoy: number; ahorroProm: number }) {
  const metasMes = sum(d.metas.map((m) => (m.periodo === "mes" ? m.monto : m.monto / 12)));
  const [tasa, setTasa] = useState(6);
  const [ahorro, setAhorro] = useState<number>(Math.round(metasMes || ahorroProm));
  const [aportLM, setAportLM] = useState(0);   // aportaciones de otros al fondo Akela por año
  const H = [1, 5, 10];
  const fv = (pv: number, pmtMes: number, anios: number) => { const r = tasa / 100 / 12; let v = pv; for (let i = 0; i < anios * 12; i++) v = v * (1 + r) + pmtMes; return v; };
  const ak = d.akela;
  const fondoEn = (anios: number) => (ak ? fv(ak.fondo_mxn, -(ak.plan_anual - aportLM) / 12, anios) : 0);
  const agota = ak ? (() => { const r = tasa / 100 / 12, g = (ak.plan_anual - aportLM) / 12; let v = ak.fondo_mxn; for (let i = 1; i <= 600; i++) { v = v * (1 + r) - g; if (v <= 0) return i / 12; } return Infinity; })() : 0;
  return (
    <div className="card">
      <div className="ct"><span>Proyección · 1, 5 y 10 años</span><span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
        <label style={{ margin: 0 }}>rendimiento <input type="number" value={tasa} step={0.5} onChange={(e) => setTasa(Number(e.target.value))} style={{ width: 60 }} /> %/año</label>
        <label style={{ margin: 0 }}>ahorro <input type="number" value={ahorro} step={1000} onChange={(e) => setAhorro(Number(e.target.value))} style={{ width: 95 }} /> /mes</label>
        {ak && <label style={{ margin: 0 }}>otros al fondo <input type="number" value={aportLM} step={10000} onChange={(e) => setAportLM(Number(e.target.value))} style={{ width: 95 }} /> /año</label>}
      </span></div>
      <div className="tbl"><table>
        <thead><tr><th></th><th className="n">Hoy</th>{H.map((h) => <th key={h} className="n">{h} año{h > 1 ? "s" : ""}</th>)}<th>Nota</th></tr></thead>
        <tbody>
          <tr><td><b>Tu patrimonio neto</b></td><td className="n">{fmt(netoHoy)}</td>{H.map((h) => <td key={h} className="n pos">{fmt(fv(netoHoy, ahorro, h))}</td>)}<td className="hint">ahorro {fmt(ahorro)}/mes ({metasMes ? "metas" : "promedio 12 m"}) al {tasa} %</td></tr>
          <tr><td>· sólo lo ahorrado</td><td className="n">·</td>{H.map((h) => <td key={h} className="n">{fmt(ahorro * 12 * h)}</td>)}<td className="hint">sin rendimiento</td></tr>
          <tr><td>· rendimiento</td><td className="n">·</td>{H.map((h) => <td key={h} className="n">{fmt(fv(netoHoy, ahorro, h) - netoHoy - ahorro * 12 * h)}</td>)}<td className="hint">lo que trabaja el capital</td></tr>
          {ak && <tr><td><b>Fondo Akela</b></td><td className="n">{fmt(ak.fondo_mxn)}</td>{H.map((h) => { const v = fondoEn(h); return <td key={h} className={"n " + (v <= 0 ? "neg" : "")}>{v <= 0 ? "agotado" : fmt(v)}</td>; })}<td className="hint">gasto {fmt(ak.plan_anual - aportLM)}/año · {agota === Infinity ? "no se agota" : `se agota en ${agota.toFixed(1)} años`}</td></tr>}
        </tbody>
      </table></div>
      <p className="hint">Interés compuesto mensual, sin inflación ni impuestos. Akela: el fondo paga el presupuesto anual completo; si parte lo cubres tú de tu flujo, el fondo dura más que esto.</p>
    </div>
  );
}

/* =====================================================================
   ISR anual tentativo
   ===================================================================== */
export function IsrTentativo({ d }: { d: AnaliticasData }) {
  const f = d.fiscal; const n = Math.max(1, f.mes_cerrado);
  const s = (k: keyof (typeof f.contab)[number]) => sum(f.contab.filter((m) => m.mes <= n).map((m) => Number(m[k] ?? 0)));
  const nomina = s("nomina_bruto"), honor = s("emitidas_subtotal"), retNom = s("nomina_isr"), retHon = s("emitidas_ret_isr");
  const [modo, setModo] = useState<"ytd" | "anual">("anual");
  const factor = modo === "anual" ? 12 / n : 1;
  const ingresos = (nomina + honor) * factor;
  const dedComp = sum(f.deducciones.map((x) => Number(x.con_comprobante ?? 0))), dedReg = sum(f.deducciones.map((x) => Number(x.registrado ?? 0)));
  const tope = Math.min(ingresos * 0.15, TOPE_DEDUCCIONES_UMA);
  const ded = Math.min(dedComp * factor, tope);
  const base = Math.max(0, ingresos - ded);
  const isr = isrAnual(base);
  const ret = (retNom + retHon) * factor, pp = f.pagos_provisionales * factor;
  const saldo = isr - ret - pp;
  const tasaEf = ingresos ? isr / ingresos : 0;
  if (!f.contab.length) return <div className="card"><div className="ct"><span>ISR anual tentativo · {f.anio}</span></div><p className="hint">Sin datos de nómina ni honorarios en {f.anio} (v_contab_mensual vacía).</p></div>;
  return (
    <div className="card">
      <div className="ct"><span>ISR anual tentativo · {f.anio}</span><span className="pills" style={{ margin: 0 }}><button type="button" className="pill" aria-pressed={modo === "anual"} onClick={() => setModo("anual")}>anualizado</button><button type="button" className="pill" aria-pressed={modo === "ytd"} onClick={() => setModo("ytd")}>a la fecha ({n} m)</button></span></div>
      <div className="stat-row">
        <div className="stat"><div className={"v " + (saldo > 0 ? "neg" : "pos")}>{fmt(Math.abs(saldo))}</div><div className="l">{saldo > 0 ? "a cargo en la anual" : "a favor en la anual"} · abril {f.anio + 1}</div></div>
        <div className="stat"><div className="v">{fmt(isr)}</div><div className="l">ISR del ejercicio · tasa efectiva {pct(isr, ingresos)}</div></div>
        <div className="stat"><div className="v">{fmt(ret + pp)}</div><div className="l">ya pagado · retenciones {fmt(ret)} + provisionales {fmt(pp)}</div></div>
      </div>
      <div className="tbl"><table style={{ fontSize: 13 }}><tbody>
        <tr><td>Sueldos (bruto)</td><td className="n">{fmt(nomina * factor)}</td><td className="hint">{f.contab.filter((m) => m.nomina_n > 0).length} recibos · ISR retenido {fmt(retNom * factor)}</td></tr>
        <tr><td>Honorarios (subtotal facturado)</td><td className="n">{fmt(honor * factor)}</td><td className="hint">retención 10 % {fmt(retHon * factor)} · sin restar gastos de la actividad</td></tr>
        <tr><td>Deducciones personales</td><td className="n">−{fmt(ded)}</td><td className="hint">con CFDI {fmt(dedComp)} (registradas {fmt(dedReg)}) · tope {fmt(tope)} = menor de 15 % de ingresos y 5 UMA ({fmt(TOPE_DEDUCCIONES_UMA)}, UMA {UMA_DIARIA})</td></tr>
        <tr><td><b>Base gravable</b></td><td className="n"><b>{fmt(base)}</b></td><td className="hint">tarifa anual art. 152 · marginal {marginal(base)} %</td></tr>
        <tr><td>ISR causado</td><td className="n">{fmt(isr)}</td><td className="hint">tasa efectiva {(tasaEf * 100).toFixed(1)} %</td></tr>
        <tr><td>− Retenciones</td><td className="n">−{fmt(ret)}</td><td></td></tr>
        <tr><td>− Pagos provisionales</td><td className="n">−{fmt(pp)}</td><td className="hint">obligaciones marcadas «pagada» con monto</td></tr>
        <tr><td><b>{saldo > 0 ? "A cargo" : "A favor"}</b></td><td className={"n " + (saldo > 0 ? "neg" : "pos")}><b>{fmt(Math.abs(saldo))}</b></td><td></td></tr>
      </tbody></table></div>
      {f.deducciones.length > 0 && <p className="hint">Deducciones por categoría: {f.deducciones.map((x) => `${DED_LABEL[x.categoria]?.split(" (")[0] ?? x.categoria} ${fmt(Number(x.con_comprobante ?? 0))}`).join(" · ")}.</p>}
      <p className="hint">Tentativo: nómina al bruto (sin exentos de aguinaldo/prima), honorarios sin deducciones de la actividad, sin subsidio al empleo ni ganancia bursátil (ésa va a su propia cédula al 10 %, ver Contabilidad). Anualizado = a la fecha × 12/{n}.</p>
    </div>
  );
}
const marginal = (base: number) => { const t = [[0.01, 1.92], [8952.5, 6.4], [75984.56, 10.88], [133536.08, 16], [155229.81, 17.92], [185852.58, 21.36], [374837.89, 23.52], [590796, 30], [1127926.85, 32], [1503902.47, 34], [4511707.38, 35]]; return [...t].reverse().find(([li]) => base >= li)?.[1] ?? 1.92; };

/* =====================================================================
   Salud financiera (0–100) + integridad
   ===================================================================== */
export function Salud({ d, runway, tasaAhorro, deudaTotal, ingAnual }: { d: AnaliticasData; runway: number; tasaAhorro: number; deudaTotal: number; ingAnual: number }) {
  const [abierto, setAbierto] = useState(false);
  const metasProg = d.metas.length ? d.metas.map((m) => { const p = metaProgreso(m, d); return clamp(p.ytd / Math.max(1, p.metaYtd)); }) : [];
  const errores = d.integridad.filter((x) => x.nivel === "error").length, avisos = d.integridad.filter((x) => x.nivel === "aviso").length;
  const comp = [
    { k: "Liquidez", v: clamp(runway / 6), peso: 25, t: `${runway === Infinity ? "∞" : runway.toFixed(1)} meses de gasto · ideal ≥ 6` },
    { k: "Tasa de ahorro", v: clamp(tasaAhorro / 0.3), peso: 20, t: `${(tasaAhorro * 100).toFixed(0)} % · ideal ≥ 30 %` },
    { k: "Deuda", v: clamp(1 - deudaTotal / Math.max(1, ingAnual * 0.5)), peso: 15, t: `${pct(deudaTotal, ingAnual)} del ingreso anual · ideal 0` },
    ...(metasProg.length ? [{ k: "Metas", v: sum(metasProg) / metasProg.length, peso: 15, t: `${Math.round((sum(metasProg) / metasProg.length) * 100)} % del ritmo esperado` }] : []),
    ...(d.akela ? [{ k: "Akela", v: clamp(1 - (d.akela.real_ytd / Math.max(1, d.akela.plan_ytd) - 1) / 0.3), peso: 10, t: `${pct(d.akela.real_ytd, d.akela.plan_ytd)} del plan a la fecha · ideal ≤ 100 %` }] : []),
    { k: "Registros", v: clamp(1 - errores * 0.25 - avisos * 0.1), peso: 15, t: `${errores} error${errores === 1 ? "" : "es"}, ${avisos} aviso${avisos === 1 ? "" : "s"}` },
  ];
  const pesoTot = sum(comp.map((c) => c.peso));
  const score = Math.round(sum(comp.map((c) => (c.v * c.peso * 100) / pesoTot)));
  const colorDe = (v: number) => (v >= 0.75 ? "var(--pos)" : v >= 0.45 ? "var(--gold)" : "var(--neg)");
  const nivelIcon = { ok: "✓", aviso: "!", error: "✕" } as const;
  return (
    <div className="card">
      <div className="ct"><span>Salud financiera</span><span className="tag">{score >= 75 ? "sólida" : score >= 50 ? "aceptable" : "frágil"}</span></div>
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center", minWidth: 120 }}>
          <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label={`Salud ${score} de 100`}>
            <circle cx={60} cy={60} r={50} fill="none" stroke="var(--cream)" strokeWidth={12} />
            <circle cx={60} cy={60} r={50} fill="none" stroke={colorDe(score / 100)} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(score / 100) * 2 * Math.PI * 50} ${2 * Math.PI * 50}`} transform="rotate(-90 60 60)" />
            <text x={60} y={60} textAnchor="middle" dominantBaseline="central" fontSize={30} fontWeight={800} fill="var(--ink)">{score}</text>
          </svg>
          <div className="hint">de 100</div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          {comp.map((c) => <div key={c.k} className="catbar" style={{ cursor: "default", margin: "4px 0" }}>
            <div className="lbl"><span>{c.k} <span className="hint" style={{ fontWeight: 400 }}>· {c.t}</span></span><span>{Math.round(c.v * 100)} <span className="hint">/ peso {c.peso}</span></span></div>
            <div className="track" style={{ height: 9 }}><div className="fill" style={{ width: `${c.v * 100}%`, background: colorDe(c.v) }} /></div>
          </div>)}
        </div>
      </div>
      <Respaldo />
      <div className="ct" style={{ marginTop: 12 }}><span>Integridad de los registros</span><button className="link" type="button" onClick={() => setAbierto(!abierto)}>{abierto ? "ocultar" : `${errores} errores · ${avisos} avisos`}</button></div>
      {(abierto || errores > 0) && <div>
        {d.integridad.filter((x) => abierto || x.nivel === "error").map((x, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-soft)", fontSize: 13 }}>
          <span style={{ width: 20, height: 20, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", background: x.nivel === "ok" ? "var(--pos)" : x.nivel === "aviso" ? "var(--gold-dark)" : "var(--neg)", flexShrink: 0 }}>{nivelIcon[x.nivel]}</span>
          <span><b>{x.titulo}</b> <span className="hint">{x.detalle}</span> {x.href && <a href={x.href} className="link">ir →</a>}</span>
        </div>)}
      </div>}
    </div>
  );
}

function Respaldo() {
  const [r, setR] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const correr = async () => {
    setR({ busy: true, msg: "Respaldando…" });
    try { const res = await fetch("/api/backup", { method: "POST" }); const j = await res.json(); if (!res.ok) throw new Error(j.error);
      setR({ busy: false, msg: `${j.zip} (${Math.round(j.zip_bytes / 1024)} KB) en Drive · ${Object.values(j.tablas as Record<string, number>).reduce((a: number, b: number) => a + b, 0)} filas · archivos copiados ${j.storage_copiados}, pendientes ${j.storage_pendientes}${j.errores?.length ? " · errores: " + j.errores.join("; ") : ""}` });
    } catch (e) { setR({ busy: false, msg: "Falló: " + (e as Error).message }); }
  };
  return <div className="ct" style={{ marginTop: 12 }}><span>Respaldo a Drive <span className="hint" style={{ fontWeight: 400 }}>· automático cada domingo (8 ZIP semanales + copia de documentos)</span></span><span style={{ display: "flex", gap: 8, alignItems: "center" }}>{r.msg && <span className="hint">{r.msg}</span>}<button className="btn ghost sm" type="button" disabled={r.busy} onClick={correr}>{r.busy ? "…" : "respaldar ahora"}</button></span></div>;
}
