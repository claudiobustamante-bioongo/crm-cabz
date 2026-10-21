"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AkelaData, PlanAkela } from "@/lib/types";
import { fmt, fmt2, MESN, ml } from "@/lib/format";

const usd = (n: number) => "US$" + Math.round(n).toLocaleString("en-US");
const QUIEN: Record<string, string> = { CABZ: "Pago yo directamente", CABU: "Transferencia a papá · él paga", MPZB: "Transferencia a mamá · ella paga", HAMB: "Luis Miguel" };
const ORDEN = ["CABZ", "CABU", "MPZB", "HAMB"];

export function Akela({ initial, soloLectura = false }: { initial: AkelaData; soloLectura?: boolean }) {
  const ro = soloLectura;
  const router = useRouter();
  const supabase = createClient();
  const [plan, setPlan] = useState<PlanAkela[]>(initial.plan);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [nueva, setNueva] = useState({ linea: "", pagador: "CABZ", monto: "", rubro_id: "", transferencia: false });
  const [pr, setPr] = useState(initial.params);
  const [retiroPct, setRetiroPct] = useState(100);   // % del presupuesto anual que saldría del fondo en la proyección
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 4500); };
  const anio = initial.anio;
  const hoy = new Date(); const mesActual = hoy.getFullYear() === anio ? hoy.getMonth() + 1 : hoy.getFullYear() > anio ? 12 : 0;

  /* ---------- plan por línea ---------- */
  const lineas = useMemo(() => {
    const m = new Map<string, { linea: string; pagador: string; transferencia: boolean; rubro_id: string | null; meses: number[] }>();
    plan.forEach((p) => { const l = m.get(p.linea) ?? { linea: p.linea, pagador: p.pagador, transferencia: p.es_transferencia, rubro_id: p.rubro_id, meses: Array(12).fill(0) }; l.meses[p.mes - 1] = Number(p.monto); m.set(p.linea, l); });
    return [...m.values()].sort((a, b) => ORDEN.indexOf(a.pagador) - ORDEN.indexOf(b.pagador) || a.linea.localeCompare(b.linea, "es"));
  }, [plan]);
  const realDe = (l: { linea: string; rubro_id: string | null }, mes: number) => initial.realPlan.filter((r) => r.mes === mes && ((l.rubro_id && r.rubro_id === l.rubro_id) || r.linea === l.linea)).reduce((a, r) => a + Number(r.real), 0);
  const realLinea = (l: { linea: string; rubro_id: string | null }) => Array.from({ length: 12 }, (_, i) => realDe(l, i + 1));
  const [abierta, setAbierta] = useState<string | null>(null);   // línea con la cuadrícula mensual abierta
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const planTotal = sum(lineas.flatMap((l) => l.meses));
  const planAFecha = sum(lineas.flatMap((l) => l.meses.slice(0, mesActual)));
  const realTotal = sum(initial.realPlan.map((r) => Number(r.real)));
  const porQuien = ORDEN.map((q) => ({ q, plan: sum(lineas.filter((l) => l.pagador === q).flatMap((l) => l.meses)), real: sum(lineas.filter((l) => l.pagador === q).flatMap((l) => realLinea(l))) })).filter((x) => x.plan || x.real);

  /* ---------- aportaciones: quién puso el dinero ---------- */
  const gastosAkela = initial.libro.filter((x) => x.concepto === "gasto");
  const aportes = initial.libro.filter((x) => x.concepto === "aportacion");
  const porMes = Array.from({ length: 12 }, (_, i) => {
    const k = `${anio}-${String(i + 1).padStart(2, "0")}`;
    const g = gastosAkela.filter((x) => x.mes.startsWith(k)), a = aportes.filter((x) => x.mes.startsWith(k));
    const yo = sum(g.filter((x) => x.quien === "CABZ").map((x) => x.salida_mxn)) + sum(a.filter((x) => (x.quien ?? "CABZ") === "CABZ").map((x) => x.entrada_mxn));
    const lm = sum(a.filter((x) => x.quien === "HAMB").map((x) => x.entrada_mxn)) + sum(g.filter((x) => x.quien === "HAMB").map((x) => x.salida_mxn));
    const papas = sum(g.filter((x) => x.quien === "CABU" || x.quien === "MPZB").map((x) => x.salida_mxn));
    return { k, yo, lm, papas };
  });
  const totYo = sum(porMes.map((m) => m.yo)), totLM = sum(porMes.map((m) => m.lm));

  /* ---------- fondo y proyección ---------- */
  const fondoMxn = initial.fondo.reduce((a, f) => a + (f.moneda === "USD" ? f.saldo * initial.tcHoy : f.saldo), 0);
  const fondoUsd = fondoMxn / (pr.tc || initial.tcHoy);
  const retiroAnualUsd = (planTotal * retiroPct / 100) / (pr.tc || initial.tcHoy);
  const aniosHasta = (r: number) => { let f = fondoUsd, n = 0; if (retiroAnualUsd <= 0) return Infinity; while (f > 0 && n < 80) { f = f * (1 + r) - retiroAnualUsd; n++; } return f > 0 ? Infinity : n; };
  const edadPapa = anio - pr.nac_papa, edadMama = anio - pr.nac_mama;
  const escenarios = [0, 0.02, pr.rend_real, 0.06].filter((v, i, a) => a.indexOf(v) === i).sort();

  /* ---------- acciones (dueño) ---------- */
  const setCelda = async (l: typeof lineas[number], mes: number, monto: number) => {
    const { error } = await supabase.rpc("plan_akela_set", { p_anio: anio, p_linea: l.linea, p_mes: mes, p_monto: monto });
    if (error) return aviso("No se guardó: " + error.message + (/function/i.test(error.message) ? " (corre 30_akela.sql)" : ""));
    setPlan((prev) => { const i = prev.findIndex((p) => p.linea === l.linea && p.mes === mes); if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], monto }; return c; } return [...prev, { id: `${l.linea}-${mes}`, anio, linea: l.linea, rubro_id: l.rubro_id, pagador: l.pagador, es_transferencia: l.transferencia, mes, monto, notas: null }]; });
  };
  const setFila = async (l: typeof lineas[number], mensual: number) => { setBusy(true); for (let m = 1; m <= 12; m++) await setCelda(l, m, mensual); setBusy(false); aviso(`${l.linea}: ${fmt(mensual)} × 12.`); };
  const agregarLinea = async () => {
    const monto = Number(nueva.monto); if (!nueva.linea.trim() || !(monto >= 0)) return aviso("Nombre y monto mensual.");
    setBusy(true);
    for (let m = 1; m <= 12; m++) { const { error } = await supabase.rpc("plan_akela_set", { p_anio: anio, p_linea: nueva.linea.trim(), p_mes: m, p_monto: monto, p_pagador: nueva.pagador, p_transferencia: nueva.transferencia, p_rubro: nueva.rubro_id || null }); if (error) { setBusy(false); return aviso("No se agregó: " + error.message); } }
    setBusy(false); setNueva({ linea: "", pagador: "CABZ", monto: "", rubro_id: "", transferencia: false }); router.refresh(); window.location.reload();
  };
  const borrarLinea = async (l: typeof lineas[number]) => {
    if (!confirm(`¿Quitar "${l.linea}" del plan ${anio}?`)) return;
    const { error } = await supabase.from("plan_akela").delete().eq("anio", anio).eq("linea", l.linea);
    if (error) return aviso(error.message); setPlan((p) => p.filter((x) => x.linea !== l.linea));
  };
  const proponer = async () => {
    const { data, error } = await supabase.rpc("proponer_plan_akela", { p_de: anio - 1, p_a: anio });
    if (error) return aviso(error.message); aviso(`${data} celdas propuestas desde el real de ${anio - 1}.`); window.location.reload();
  };
  const guardarParams = async () => {
    const { error } = await supabase.from("app_config").update({ akela_nac_papa: pr.nac_papa, akela_nac_mama: pr.nac_mama, akela_rend_real: pr.rend_real, akela_tc: pr.tc }).not("owner_id", "is", null);
    aviso(error ? "No se guardó: " + error.message : "Parámetros guardados.");
  };

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + " %" : "—");
  const inp = { padding: "3px 5px", fontSize: 12, width: 86, textAlign: "right" as const };

  return (
    <section>
      <div className="idea"><b>Akela</b> El patrimonio y los gastos de tus papás en un solo lugar: el presupuesto del año línea por línea (quién lo paga), cómo va contra lo real, cuánto has puesto tú y cuánto Luis Miguel, el saldo del fondo y hasta qué edad alcanza. {ro && "Vista de solo lectura."}</div>

      <div className={"card" + (busy ? " spin" : "")}>
        <div className="g4">
          <div><label htmlFor="k-anio">Año</label><select id="k-anio" value={anio} onChange={(e) => router.push(`/akela?anio=${e.target.value}`)}>{initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
          <div className="stat"><div className="v">{fmt(planTotal)}</div><div className="l">Presupuesto {anio}</div></div>
          <div className="stat"><div className={"v " + (realTotal > planAFecha ? "neg" : "pos")}>{fmt(realTotal)}</div><div className="l">Real a la fecha · {pct(realTotal, planAFecha)} del plan a la fecha ({fmt(planAFecha)})</div></div>
          <div className="stat"><div className="v">{fmt(fondoMxn)}</div><div className="l">Fondo Akela · {planTotal ? (fondoMxn / planTotal).toFixed(1) : "—"} años de presupuesto</div></div>
        </div>
        {/* avance del presupuesto total: barra horizontal con marca del mes */}
        <div style={{ marginTop: 10 }}>
          <div className="lbl" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span><b>Presupuesto total {anio}</b> · real {fmt(realTotal)} de {fmt(planTotal)}</span><span>{mesActual ? `${MESN[mesActual - 1]} · ${Math.round((mesActual / 12) * 100)} % del año` : ""}</span></div>
          <div style={{ position: "relative", height: 22, border: "1.5px solid var(--ink)", borderRadius: 11, background: "var(--cream)", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${planTotal ? Math.min(100, (realTotal / planTotal) * 100) : 0}%`, background: realTotal > planAFecha ? "var(--deu)" : "var(--aho)" }} />
            {mesActual > 0 && <div style={{ position: "absolute", left: `${(mesActual / 12) * 100}%`, top: 0, bottom: 0, borderLeft: "2px dashed var(--ink)" }} title="Hoy" />}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>{pct(realTotal, planTotal)} gastado · {pct(realTotal, planAFecha)} vs plan a la fecha</div>
          </div>
        </div>
        {/* aportaciones: barra apilada yo vs Luis Miguel */}
        <div style={{ marginTop: 10 }}>
          <div className="lbl" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span><b>Quién ha puesto el dinero en {anio}</b></span><span>yo {fmt(totYo)} · Luis Miguel {fmt(totLM)} · ellos {fmt(sum(porMes.map((m) => m.papas)))}</span></div>
          {(() => { const t = totYo + totLM + sum(porMes.map((m) => m.papas)) || 1; const py = (totYo / t) * 100, pl = (totLM / t) * 100, pp = 100 - py - pl; return (
            <div style={{ display: "flex", height: 22, border: "1.5px solid var(--ink)", borderRadius: 11, overflow: "hidden", fontSize: 11, fontWeight: 700, color: "#fff" }}>
              <div style={{ width: `${py}%`, background: "var(--c6)", display: "flex", alignItems: "center", paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }} title={`Yo: ${fmt(totYo)}`}>{py > 12 ? `yo ${Math.round(py)} %` : ""}</div>
              <div style={{ width: `${pl}%`, background: "var(--nec)", display: "flex", alignItems: "center", paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }} title={`Luis Miguel: ${fmt(totLM)}`}>{pl > 12 ? `Luis Miguel ${Math.round(pl)} %` : ""}</div>
              <div style={{ width: `${pp}%`, background: "var(--akela)", display: "flex", alignItems: "center", paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }} title="Pagado por papás con lo transferido">{pp > 12 ? `ellos ${Math.round(pp)} %` : ""}</div>
            </div>); })()}
        </div>
      </div>

      <h2>1 · Presupuesto {anio} · línea por línea</h2>
      <div className="card full-bleed">
        <div className="ct"><span>Plan vs real</span>
          {!ro && <button className="btn ghost sm" type="button" onClick={proponer} title={`Llena las celdas vacías con el promedio real de ${anio - 1}`}>Proponer desde real {anio - 1}</button>}</div>
        <div className="tbl"><table>
          <thead><tr><th>Línea</th><th>Quién paga</th><th className="n">Mensual</th><th className="n">Plan anual</th><th className="n">Real a la fecha</th><th className="n">Plan a la fecha</th><th style={{ width: 220 }}>Avance</th><th className="n">Desviación</th><th></th></tr></thead>
          <tbody>
            {ORDEN.filter((q) => lineas.some((l) => l.pagador === q)).map((q) => (
              <Fragment key={q}>
                <tr className="sec"><td colSpan={9}>{QUIEN[q] ?? q} · plan {fmt(sum(lineas.filter((l) => l.pagador === q).flatMap((l) => l.meses)))} · real {fmt(sum(lineas.filter((l) => l.pagador === q).flatMap((l) => realLinea(l))))}</td></tr>
                {lineas.filter((l) => l.pagador === q).map((l) => { const re = realLinea(l); const tp = sum(l.meses), tr = sum(re), tpf = sum(l.meses.slice(0, mesActual)); const uniforme = l.meses.every((v) => v === l.meses[0]); const av = tp ? Math.min(100, (tr / tp) * 100) : 0; const avf = tp ? Math.min(100, (tpf / tp) * 100) : 0; const des = tr - tpf; return (
                  <Fragment key={l.linea}>
                    <tr>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{l.linea}{l.transferencia ? <span className="badge" style={{ background: "var(--nec)", marginLeft: 6 }}>transferencia</span> : null}{!l.rubro_id && <span className="hint" title="sin subrubro ligado: no se compara con real"> ·</span>}</td>
                      <td>{l.pagador}</td>
                      <td className="n">{ro ? (uniforme ? fmt(l.meses[0]) : "varía") : <input type="number" defaultValue={uniforme ? l.meses[0] || "" : ""} placeholder={uniforme ? "" : "varía"} onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && (!uniforme || v !== l.meses[0])) setFila(l, v); }} style={inp} title="Se aplica a los 12 meses" />}</td>
                      <td className="n" style={{ fontWeight: 700 }}>{fmt(tp)}</td>
                      <td className={"n" + (des > 0 ? " neg" : "")}>{fmt(tr)}</td>
                      <td className="n">{fmt(tpf)}</td>
                      <td><div style={{ position: "relative", height: 12, border: "1px solid var(--ink)", borderRadius: 6, background: "var(--cream)", overflow: "hidden" }}><div style={{ width: `${av}%`, height: "100%", background: des > 0 ? "var(--deu)" : "var(--aho)" }} /><div style={{ position: "absolute", left: `${avf}%`, top: 0, bottom: 0, borderLeft: "2px dashed var(--ink)" }} /></div></td>
                      <td className={"n " + (des > 0 ? "neg" : des < 0 ? "pos" : "")}>{tpf ? (des > 0 ? "+" : "") + fmt(des) : "·"}</td>
                      <td style={{ whiteSpace: "nowrap" }}><button className="link" type="button" onClick={() => setAbierta(abierta === l.linea ? null : l.linea)}>{abierta === l.linea ? "ocultar meses" : "meses"}</button>{!ro && <> <button className="del" type="button" onClick={() => borrarLinea(l)}>✕</button></>}</td>
                    </tr>
                    {abierta === l.linea && (
                      <tr><td colSpan={9} style={{ background: "var(--bone)", padding: "6px 10px" }}>
                        <div className="tbl"><table style={{ fontSize: 12 }}>
                          <thead><tr><th></th>{MESN.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">Año</th></tr></thead>
                          <tbody>
                            <tr><td>plan</td>{l.meses.map((v, i) => <td key={i} className="n">{ro ? fmt(v) : <input type="number" defaultValue={v || ""} onBlur={(e) => Number(e.target.value) !== v && setCelda(l, i + 1, Number(e.target.value) || 0)} style={inp} />}</td>)}<td className="n" style={{ fontWeight: 700 }}>{fmt(tp)}</td></tr>
                            <tr><td>real</td>{re.map((v, i) => <td key={i} className={"n" + (v > l.meses[i] && l.meses[i] ? " neg" : "")}>{v ? fmt(v) : "·"}</td>)}<td className="n" style={{ fontWeight: 700 }}>{fmt(tr)}</td></tr>
                          </tbody>
                        </table></div>
                      </td></tr>)}
                  </Fragment>); })}
              </Fragment>))}
            {!lineas.length && <tr><td colSpan={9} className="hint">Sin plan para {anio}. {!ro && "Agrega líneas abajo o propón desde el año anterior."}</td></tr>}
            {lineas.length > 0 && <tr className="tot"><td>Total</td><td /><td /><td className="n">{fmt(planTotal)}</td><td className="n">{fmt(realTotal)}</td><td className="n">{fmt(planAFecha)}</td><td /><td className={"n " + (realTotal - planAFecha > 0 ? "neg" : "pos")}>{(realTotal - planAFecha > 0 ? "+" : "") + fmt(realTotal - planAFecha)}</td><td /></tr>}
          </tbody>
        </table></div>
        {!ro && (
          <div className="g4" style={{ marginTop: 10 }}>
            <div><label htmlFor="n-linea">Nueva línea</label><input id="n-linea" type="text" value={nueva.linea} onChange={(e) => setNueva({ ...nueva, linea: e.target.value })} placeholder="p. ej. Jardinero" /></div>
            <div><label htmlFor="n-pag">Quién paga</label><select id="n-pag" value={nueva.pagador} onChange={(e) => setNueva({ ...nueva, pagador: e.target.value })}>{initial.pagadores.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre}</option>)}</select></div>
            <div><label htmlFor="n-rub">Subrubro Akela (para comparar con real)</label><select id="n-rub" value={nueva.rubro_id} onChange={(e) => setNueva({ ...nueva, rubro_id: e.target.value })}><option value="">— sin ligar —</option>{initial.rubrosAkela.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></div>
            <div><label htmlFor="n-monto">Mensual</label><div style={{ display: "flex", gap: 6 }}><input id="n-monto" type="number" value={nueva.monto} onChange={(e) => setNueva({ ...nueva, monto: e.target.value })} /><button className="btn sm" type="button" onClick={agregarLinea} disabled={busy}>+</button></div>
              <label style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}><input type="checkbox" checked={nueva.transferencia} onChange={(e) => setNueva({ ...nueva, transferencia: e.target.checked })} /> es transferencia a papá/mamá</label></div>
          </div>)}
        <p className="hint">«Mensual» se aplica a los 12 meses; para un mes distinto abre «meses». La barra muestra lo gastado del plan anual y la línea punteada dónde deberías ir hoy; rojo = por arriba del plan a la fecha. Las líneas que pago yo se comparan con Gastos (libro Akela); las transferencias son lo que les mando; lo que ellos pagan con eso queda como referencia.</p>
      </div>

      <h2>2 · Aportaciones {anio} · yo vs Luis Miguel</h2>
      <div className="card">
        <div className="tbl"><table>
          <thead><tr><th>Mes</th><th className="n">Puse yo (gastos + depósitos)</th><th className="n">Luis Miguel</th><th className="n">Pagaron ellos (de lo transferido)</th><th className="n">Acumulado yo</th><th className="n">Acumulado LM</th><th className="n">% LM</th></tr></thead>
          <tbody>
            {(() => { let ay = 0, al = 0; return porMes.filter((m) => m.yo || m.lm || m.papas).map((m) => { ay += m.yo; al += m.lm; return (
              <tr key={m.k}><td>{ml(m.k)}</td><td className="n">{fmt(m.yo)}</td><td className={"n" + (m.lm ? " pos" : "")}>{m.lm ? fmt(m.lm) : "·"}</td><td className="n">{m.papas ? fmt(m.papas) : "·"}</td><td className="n">{fmt(ay)}</td><td className="n">{fmt(al)}</td><td className="n">{pct(al, ay + al)}</td></tr>); }); })()}
            <tr className="tot"><td>Año</td><td className="n">{fmt(totYo)}</td><td className="n">{fmt(totLM)}</td><td className="n">{fmt(sum(porMes.map((m) => m.papas)))}</td><td className="n">{fmt(totYo)}</td><td className="n">{fmt(totLM)}</td><td className="n">{pct(totLM, totYo + totLM)}</td></tr>
          </tbody>
        </table></div>
        {aportes.length > 0 && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer" }}>Depósitos al fondo ({aportes.length})</summary>
          <div className="tbl"><table><tbody>{aportes.map((a, i) => <tr key={i}><td>{a.fecha}</td><td>{a.quien ?? "CABZ"}</td><td style={{ whiteSpace: "normal" }}>{a.descripcion}</td><td className="n">{fmt2(a.entrada_mxn)}</td></tr>)}</tbody></table></div></details>}
        <p className="hint">Lo que pagas de Akela con tus cuentas cuenta como aportación tuya; Luis Miguel compensa con depósitos al fondo (o pagando gastos a su nombre).</p>
      </div>

      <h2>3 · Fondo Akela y proyección</h2>
      <div className="g2">
        <div className="card">
          <div className="ct">Saldo del fondo</div>
          {initial.fondo.map((f) => <div key={f.nombre} className="mov"><span><b style={{ color: "var(--ink)" }}>{f.nombre}</b> <span style={{ color: "var(--gray-soft)", fontSize: 12 }}>{f.fecha ? `al ${f.fecha}` : ""}{f.fuente ? ` · ${f.fuente}` : ""}</span></span><span className="r"><b style={{ color: "var(--ink)" }}>{f.moneda === "USD" ? usd(f.saldo) : fmt(f.saldo)}</b></span></div>)}
          <div className="stat-row" style={{ marginTop: 8 }}>
            <div className="stat"><div className="v">{fmt(fondoMxn)}</div><div className="l">Total en MXN · TC {initial.tcHoy.toFixed(2)}</div></div>
            <div className="stat"><div className="v">{planTotal ? (fondoMxn / planTotal).toFixed(1) : "—"} años</div><div className="l">de presupuesto, sin rendimiento</div></div>
          </div>
          <p className="hint">CBZBurguer es la cuenta de tus papás en IBKR. El net worth personal no la incluye.</p>
        </div>
        <div className="card">
          <div className="ct"><span>¿Hasta qué edad alcanza?</span><span className="tag">papá {edadPapa} · mamá {edadMama} años en {anio}</span></div>
          <div className="g2">
            <div><label htmlFor="p-ret">% del presupuesto que saldría del fondo</label><input id="p-ret" type="number" value={retiroPct} min={0} max={200} onChange={(e) => setRetiroPct(Number(e.target.value))} /></div>
            <div><label htmlFor="p-tc">TC de largo plazo</label><input id="p-tc" type="number" step="0.01" value={pr.tc} onChange={(e) => setPr({ ...pr, tc: Number(e.target.value) })} disabled={ro} /></div>
            <div><label htmlFor="p-r">Rendimiento real anual (USD)</label><input id="p-r" type="number" step="0.005" value={pr.rend_real} onChange={(e) => setPr({ ...pr, rend_real: Number(e.target.value) })} disabled={ro} /></div>
            <div><label>Años de nacimiento papá · mamá</label><div style={{ display: "flex", gap: 6 }}><input type="number" value={pr.nac_papa} onChange={(e) => setPr({ ...pr, nac_papa: Number(e.target.value) })} disabled={ro} /><input type="number" value={pr.nac_mama} onChange={(e) => setPr({ ...pr, nac_mama: Number(e.target.value) })} disabled={ro} /></div></div>
          </div>
          <div className="tbl" style={{ marginTop: 8 }}><table>
            <thead><tr><th>Rendimiento real</th><th className="n">Retiro anual</th><th className="n">Alcanza</th><th className="n">Papá hasta</th><th className="n">Mamá hasta</th></tr></thead>
            <tbody>{escenarios.map((r) => { const n = aniosHasta(r); return (
              <tr key={r} className={r === pr.rend_real ? "tot" : undefined}><td>{(r * 100).toFixed(1)} %{r === pr.rend_real ? " · base" : ""}</td><td className="n">{usd(retiroAnualUsd)}</td><td className="n">{n === Infinity ? "no se acaba" : `${n} años (${anio + n})`}</td><td className="n">{n === Infinity ? "—" : edadPapa + n}</td><td className="n">{n === Infinity ? "—" : edadMama + n}</td></tr>); })}</tbody>
          </table></div>
          {!ro && <div className="center" style={{ marginTop: 6 }}><button className="btn ghost sm" type="button" onClick={guardarParams}>Guardar parámetros</button></div>}
          <p className="hint">Hoy el presupuesto sale de tu bolsa y el fondo no se toca: con 0 % no se acaba nunca. El escenario base ({(pr.rend_real * 100).toFixed(0)} % real, TC {pr.tc}) muestra qué pasaría si todo el presupuesto saliera del fondo. Sin inflación: los montos son de hoy.</p>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
