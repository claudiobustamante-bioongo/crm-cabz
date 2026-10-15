"use client";
import { Fragment, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CuentaSaldo, IbkrMes, InversionesData, TipoCambio } from "@/lib/types";
import { MESN, fmt, hoy, ml, niceStep } from "@/lib/format";
import { parseIBCSV } from "@/lib/ibkr";

const usd = (n: number) => (n < 0 ? "-" : "") + "US$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fReal = (r: IbkrMes) => r.real_etf + r.real_acc + r.real_opc + r.real_fx + r.real_bono;
const fNR = (r: IbkrMes) => r.nr_etf + r.nr_acc + r.nr_opc + r.nr_fx + r.nr_bono;
const fPas = (r: IbkrMes) => r.div_bruto - r.div_ret + r.cupon;
const fCost = (r: IbkrMes) => r.comisiones + r.int_broker;
const yOf = (r: IbkrMes) => +r.periodo.slice(0, 4), mOf = (r: IbkrMes) => +r.periodo.slice(5, 7);
const finMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

export function Inversiones({ initial }: { initial: InversionesData }) {
  const supabase = createClient();
  const [filas, setFilas] = useState<IbkrMes[]>(initial.filas);
  const [tcs, setTcs] = useState<TipoCambio[]>(initial.tc);
  const [retiro, setRetiro] = useState<CuentaSaldo[]>(initial.retiro);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [drill, setDrill] = useState("");
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 4000); };

  const years = useMemo(() => [...new Set(filas.map(yOf))].sort(), [filas]);
  const [year, setYear] = useState<number>(years.at(-1) ?? new Date().getFullYear());
  const [mode, setMode] = useState<"mxn" | "usd">("mxn");
  const [acc, setAcc] = useState("");
  const accs = acc ? initial.cuentasIbkr.filter((c) => c.id === acc) : initial.cuentasIbkr;
  const nombre = (c: { nombre: string; titular: string }) => c.nombre.replace(/^IBKR /, "") + (c.titular === "CABZ" ? " · tuya" : " · Akela");

  /* ---------- tipo de cambio ---------- */
  const tcMap = useMemo(() => Object.fromEntries(tcs.map((t) => [t.fecha.slice(0, 7), t.tc_mxn])), [tcs]);
  const tcReal = (y: number, m: number) => tcMap[`${y}-${String(m).padStart(2, "0")}`] ?? 0;
  const tcOf = (y: number, m: number) => {
    if (tcReal(y, m)) return tcReal(y, m);
    for (let yy = y; yy >= y - 2; yy--) for (let mm = yy === y ? m : 12; mm >= 1; mm--) if (tcReal(yy, mm)) return tcReal(yy, mm);
    return 0;
  };
  const conv = (u: number, y: number, m: number) => mode === "usd" ? { v: u, ok: true } : tcOf(y, m) ? { v: u * tcOf(y, m), ok: true } : { v: 0, ok: false };
  const vfmt = (v: number) => (mode === "usd" ? usd(v) : fmt(v));

  const rowsOf = (cid: string, y: number) => filas.filter((r) => r.cuenta_id === cid && yOf(r) === y).sort((a, b) => mOf(a) - mOf(b));
  const flujo = (cid: string, y: number, f: (r: IbkrMes) => number) => { let t = 0, ok = true; rowsOf(cid, y).forEach((r) => { const u = f(r) || 0; if (!u) return; const c = conv(u, y, mOf(r)); if (c.ok) t += c.v; else ok = false; }); return { v: t, ok }; };
  const cierre = (cid: string, y: number, f: (r: IbkrMes) => number) => { const rs = rowsOf(cid, y); if (!rs.length) return { v: 0, ok: true }; const r = rs.at(-1)!; return conv(f(r) || 0, y, mOf(r)); };
  const sum = (f: (cid: string) => { v: number }) => accs.reduce((a, c) => a + f(c.id).v, 0);

  const real = sum((c) => flujo(c, year, fReal)), nr = sum((c) => cierre(c, year, fNR)), pas = sum((c) => flujo(c, year, fPas)),
    cost = sum((c) => flujo(c, year, fCost)), nav = sum((c) => cierre(c, year, (r) => r.nav_final)), dep = sum((c) => flujo(c, year, (r) => r.depositos));
  const divB = sum((c) => flujo(c, year, (r) => Math.max(0, r.div_bruto))), divR = sum((c) => flujo(c, year, (r) => r.div_ret)), cup = sum((c) => flujo(c, year, (r) => Math.max(0, r.cupon)));

  /* ---------- NAV chart (USD, todos los años) ---------- */
  const W = 760, H = 200, P = { l: 60, r: 8, t: 10, b: 24 };
  const pts = (cid: string) => filas.filter((r) => r.cuenta_id === cid).sort((a, b) => a.periodo.localeCompare(b.periodo)).map((r) => [r.periodo.slice(0, 7), r.nav_final] as [string, number]);
  const allPts = initial.cuentasIbkr.flatMap((c) => pts(c.id));
  const labels = [...new Set(allPts.map((p) => p[0]))].sort();
  const mxN = Math.max(...allPts.map((p) => p[1]), 1), stepN = niceStep(mxN), maxN = Math.ceil(mxN / stepN) * stepN;
  const xN = (l: string) => P.l + (W - P.l - P.r) * labels.indexOf(l) / Math.max(1, labels.length - 1), yN = (v: number) => P.t + (H - P.t - P.b) * (1 - v / maxN);
  const gridN: number[] = []; for (let v = 0; v <= maxN; v += stepN) gridN.push(v);
  const colorOf = (c: { titular: string }) => c.titular === "CABZ" ? "var(--c6)" : "var(--akela)";

  /* ---------- tabla principal ---------- */
  type Line = { lbl: string; f: (r: IbkrMes) => number; kind: "flujo" | "cierre"; key: string; tot?: boolean };
  const line = ({ lbl, f, kind, key, tot: isTot }: Line) => {
    let tot = 0, ok = true; const cells = [];
    const last = Math.max(0, ...accs.map((c) => rowsOf(c.id, year).at(-1)).map((r) => (r ? mOf(r) : 0)));
    for (let m = 1; m <= 12; m++) {
      let v = 0, any = false;
      accs.forEach((c) => { const r = rowsOf(c.id, year).find((d) => mOf(d) === m); if (!r) return; const u = f(r) || 0; if (kind === "cierre") { v += u; any = true; return; } if (!u) return; const cv = conv(u, year, m); if (cv.ok) { v += cv.v; any = true; } else ok = false; });
      if (kind === "cierre" && any) { const cv = conv(v, year, m); if (m === last) tot = cv.ok ? cv.v : 0; v = cv.v; } else if (kind !== "cierre") tot += v;
      cells.push(any ? <td key={m} className={"n" + (v < 0 ? " neg" : "")} style={{ cursor: "pointer", textDecoration: "underline dotted" }} onClick={() => drillTo(key, m)}>{vfmt(v)}</td> : <td key={m} className="n dim">—</td>);
    }
    return <tr key={key} className={isTot ? "tot" : undefined}><td>{lbl}</td>{cells}<td className="n" style={{ fontWeight: 700 }}>{ok ? vfmt(tot) : <span className="badge" style={{ background: "var(--deu)" }}>s/TC</span>}</td></tr>;
  };
  const sec = (t: string) => <tr key={"s" + t} className="sec"><td colSpan={14}>{t}</td></tr>;
  const drillTo = (k: string, m: number) => {
    const parts = accs.map((c) => { const r = rowsOf(c.id, year).find((d) => mOf(d) === m); if (!r) return ""; const map: Record<string, string> = {
      div: `dividendos ${r.div_bruto} − retención ${r.div_ret}`, cup: `cupones ${r.cupon}`, re: `ETFs ${r.real_etf}`, ra: `acciones ${r.real_acc}`, ro: `opciones ${r.real_opc}`, rf: `forex ${r.real_fx}`, rb: `bonos ${r.real_bono}`,
      real: `${r.real_etf}+${r.real_acc}+${r.real_opc}+${r.real_fx}+${r.real_bono}`, nr: `${r.nr_etf}+${r.nr_acc}+${r.nr_opc}+${r.nr_fx}+${r.nr_bono}`, cm: `comisiones ${r.comisiones}`, ib: `interés ${r.int_broker}`,
      nav: `efectivo ${r.nav_efe} + acciones ${r.nav_acc} + opciones ${r.nav_opc} + bonos ${r.nav_bono} + devengos ${r.nav_dev}`, dep: `depósitos ${r.depositos}` }; return `${nombre(c)}: ${map[k]} USD${r.fuente ? ` · ${r.fuente}` : ""}`; }).filter(Boolean);
    setDrill(`${MESN[m - 1]} ${year} · ${parts.join(" · ")} · × TC ${tcOf(year, m) || "—"}`);
  };

  /* ---------- acciones ---------- */
  const guardarTc = async (m: number, v: number) => {
    const fecha = `${year}-${String(m).padStart(2, "0")}-01`;
    if (!v) { const { error } = await supabase.from("tipos_cambio").delete().eq("fecha", fecha).eq("moneda", "USD"); if (error) return aviso(error.message); setTcs((p) => p.filter((t) => t.fecha !== fecha)); return; }
    const row = { fecha, moneda: "USD", tc_mxn: v, fuente: "captura manual" };
    const { error } = await supabase.from("tipos_cambio").upsert(row, { onConflict: "fecha,moneda" });
    if (error) return aviso("No se guardó el TC: " + error.message);
    setTcs((p) => [...p.filter((t) => t.fecha !== fecha), row]);
  };
  const traerBanxico = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tc?anio=${year}`); const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      setTcs((p) => [...p.filter((t) => !t.fecha.startsWith(String(year))), ...j.rows]);
      aviso(`Banxico: ${j.meses} meses de ${year} actualizados.`);
    } catch (e) { aviso("Banxico: " + (e as Error).message); } finally { setBusy(false); }
  };

  const traerFlex = async (hoy = false) => {
    setBusy(true);
    try {
      const r = await fetch("/api/ibkr/flex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hoy }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      const ok = (j.filas as { cuenta: string; periodo?: string; parcial?: boolean; error?: string }[]).filter((f) => !f.error);
      aviso(ok.length ? `IBKR: ${ok.map((f) => `${f.cuenta.replace(/^IBKR /, "")} ${f.periodo?.slice(0, 7)}${f.parcial ? " (parcial)" : ""}`).join(", ")}. Recarga para ver la tabla.` : "IBKR no devolvió cuentas conocidas.");
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) { aviso("IBKR Flex: " + (e as Error).message); } finally { setBusy(false); }
  };

  const importar = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    let n = 0;
    try {
      for (const f of Array.from(files)) {
        const r = parseIBCSV(await f.text(), f.name);
        const c = initial.cuentasIbkr.find((x) => r.cuenta && x.nombre.includes(r.cuenta));
        if (!c || !r.year || !r.mes) { aviso(`No pude leer ${f.name}`); continue; }
        const periodo = `${r.year}-${String(r.mes).padStart(2, "0")}-01`;
        const { data: imp, error: e0 } = await supabase.from("importaciones").insert({ tipo: "ibkr_csv", archivo: f.name, cuenta_id: c.id, periodo, filas: 1 }).select("id").single();
        if (e0) throw e0;
        const row = {
          cuenta_id: c.id, periodo, importacion_id: imp.id, moneda_reporte: "USD", moneda_base: "USD", fuente: f.name,
          real_etf: r.re, real_acc: r.ra, real_opc: r.ro, real_fx: r.rf, real_bono: r.rb, nr_etf: r.sne, nr_acc: r.sna, nr_opc: r.sno, nr_fx: r.snf, nr_bono: r.snb,
          div_bruto: r.db, div_ret: r.dr, cupon: r.cb, cupon_ret: r.cr, comisiones: r.cm, int_broker: r.ib, depositos: r.dep,
          nav_efe: r.nav_efe, nav_acc: r.nav_acc, nav_opc: r.nav_opc, nav_bono: r.nav_bono, nav_dev: r.nav_dev, nav_final: r.nav_tot,
          pnl_realizado: r.re + r.ra + r.ro + r.rf + r.rb, pnl_no_realizado: r.sne + r.sna + r.sno + r.snf + r.snb, dividendos: r.db, retenciones: r.dr, intereses: r.ib,
        };
        const { data: saved, error: e1 } = await supabase.from("ibkr_estados_mensuales").upsert(row, { onConflict: "cuenta_id,periodo" }).select("*").single();
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("saldos_cuenta").upsert({ cuenta_id: c.id, fecha: finMes(r.year, r.mes), saldo: r.nav_tot, fuente: "IBKR estado de cuenta" }, { onConflict: "cuenta_id,fecha" });
        if (e2) aviso("Mes guardado, pero el saldo no: " + e2.message);
        const num = Object.fromEntries(Object.entries(saved as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as unknown as IbkrMes;
        setFilas((p) => [...p.filter((x) => !(x.cuenta_id === c.id && x.periodo === periodo)), num]);
        setRetiro((p) => p.map((x) => (x.id === c.id ? { ...x, saldo: r.nav_tot, fecha: finMes(r.year!, r.mes!), fuente: "IBKR estado de cuenta" } : x)));
        if (r.year !== year) setYear(r.year);
        n++;
      }
      if (n) aviso(`${n} mes${n > 1 ? "es" : ""} de IBKR importado${n > 1 ? "s" : ""}.`);
    } catch (e) { aviso("Importación: " + (e as Error).message); } finally { setBusy(false); }
  };

  const [sCta, setSCta] = useState(initial.retiro.find((c) => c.tipo === "retiro")?.id ?? "");
  const [sSaldo, setSSaldo] = useState(""); const [sFecha, setSFecha] = useState(hoy());
  const guardarSaldo = async () => {
    const v = Number(sSaldo); if (!v || !sCta) return;
    const { error } = await supabase.from("saldos_cuenta").upsert({ cuenta_id: sCta, fecha: sFecha, saldo: v, fuente: "captura manual" }, { onConflict: "cuenta_id,fecha" });
    if (error) return aviso("No se guardó: " + error.message);
    setRetiro((p) => p.map((x) => (x.id === sCta ? { ...x, saldo: v, fecha: sFecha, fuente: "captura manual" } : x)));
    setSSaldo(""); aviso("Saldo actualizado. El net worth se recalcula al recargar.");
  };

  const nw = initial.netWorth;
  const rows2 = initial.cuentasIbkr.flatMap((c) => years.filter((y) => rowsOf(c.id, y).length).map((y) => ({ c, y })));

  return (
    <section>
      <div className="idea"><b>Cómo funciona</b>Mismos datos y metodología que tu Panel Contable: cada mes de IBKR por cuenta (Bioongo tuya, CBZBurguer de tus papás), FIX de cierre de mes, y el ISR que generan dividendos y cupones. Sube el CSV mensual y la tabla se actualiza; el TC se trae de Banxico con un clic.</div>

      <div className={"card" + (busy ? " spin" : "")}>
        <div className="g4">
          <div><label htmlFor="v-year">Año</label><select id="v-year" value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
          <div><label htmlFor="v-mode">Moneda</label><select id="v-mode" value={mode} onChange={(e) => setMode(e.target.value as "mxn" | "usd")}><option value="mxn">MXN (al FIX del mes)</option><option value="usd">USD</option></select></div>
          <div><label htmlFor="v-acc">Cuenta</label><select id="v-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Ambas</option>{initial.cuentasIbkr.map((c) => <option key={c.id} value={c.id}>{nombre(c)}</option>)}</select></div>
          <div><label>&nbsp;</label>
            {initial.flex
              ? <button className="btn sm" type="button" style={{ width: "100%" }} onClick={() => traerFlex(false)} disabled={busy}>⟳ Traer de IBKR (Flex)</button>
              : <label className="door" htmlFor="v-csv" style={{ margin: 0, padding: 9 }}>⬆ Subir CSV de IBKR</label>}
            <input id="v-csv" type="file" accept=".csv" multiple hidden onChange={(e) => { importar(e.target.files); e.target.value = ""; }} /></div>
        </div>
        <p className="hint">{initial.flex
          ? <>Flex trae el mes que tenga configurado la query (normalmente el mes anterior) para las dos cuentas y reemplaza el mes si ya existía. ¿Un CSV suelto? <label htmlFor="v-csv" style={{ display: "inline", cursor: "pointer", textDecoration: "underline", color: "var(--gold-dark)", margin: 0, fontWeight: 600 }}>súbelo aquí</label>.</>
          : <>El archivo mensual de IBKR (Activity Statement, CSV) se llama U&lt;cuenta&gt;_AAAAMM_AAAAMM.csv. Si ya existe el mes, se reemplaza. Con IBKR_FLEX_TOKEN y IBKR_FLEX_QUERY_ID en Vercel aparece el botón para traerlo solo.</>}</p>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="v">{vfmt(nav)}</div><div className="l">NAV cierre</div></div>
        <div className="stat"><div className={"v " + (real < 0 ? "neg" : "pos")}>{vfmt(real)}</div><div className="l">Realizada</div></div>
        <div className="stat"><div className={"v " + (nr < 0 ? "neg" : "pos")}>{vfmt(nr)}</div><div className="l">No realizada (cierre)</div></div>
        <div className="stat"><div className="v">{vfmt(pas)}</div><div className="l">Dividendos + cupones netos</div></div>
        <div className="stat"><div className="v neg">{vfmt(cost)}</div><div className="l">Comisiones e intereses</div></div>
        <div className="stat"><div className="v">{vfmt(dep)}</div><div className="l">Depósitos netos</div></div>
      </div>

      <div className="card">
        <div className="ct"><span>NAV por cuenta</span><span className="legend">{initial.cuentasIbkr.map((c) => <span key={c.id}><i style={{ background: colorOf(c) }} />{nombre(c)}</span>)}</span></div>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="NAV mensual en USD">
          {gridN.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={yN(v)} y2={yN(v)} stroke="var(--border-soft)" /><text x={P.l - 6} y={yN(v) + 4} textAnchor="end">{Math.round(v / 1000)}k</text></g>)}
          {labels.map((l, i) => ((i % 4 === 0 && labels.length - 1 - i >= 2) || i === labels.length - 1) ? <text key={l} x={xN(l)} y={H - 7} textAnchor="middle">{ml(l)}</text> : null)}
          {initial.cuentasIbkr.map((c) => { const p = pts(c.id); if (!p.length) return null; const e = p.at(-1)!; return (
            <g key={c.id}><path d={p.map((q, i) => `${i ? "L" : "M"}${xN(q[0]).toFixed(1)},${yN(q[1]).toFixed(1)}`).join("")} fill="none" stroke={colorOf(c)} strokeWidth={2.5} /><circle cx={xN(e[0])} cy={yN(e[1])} r={4} fill={colorOf(c)} stroke="var(--ink)" /></g>); })}
        </svg>
        <p className="hint">USD, todos los meses importados.</p>
      </div>

      <div className="card">
        <div className="ct"><span>Año {year} · {mode === "usd" ? "USD" : "MXN al FIX"}</span><span className="tag">toca una celda para ver de dónde sale</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Concepto</th>{MESN.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">Año</th></tr></thead>
          <tbody>
            {sec("1 · Ingresos pasivos (dividendos netos + cupones)")}
            {line({ lbl: "Dividendos netos", f: (r) => r.div_bruto - r.div_ret, kind: "flujo", key: "div" })}
            {line({ lbl: "Cupones de bonos", f: (r) => r.cupon, kind: "flujo", key: "cup" })}
            {sec("2 · Realizada (Cap. IV · solo en la anual)")}
            {line({ lbl: "ETFs", f: (r) => r.real_etf, kind: "flujo", key: "re" })}
            {line({ lbl: "Acciones", f: (r) => r.real_acc, kind: "flujo", key: "ra" })}
            {line({ lbl: "Opciones", f: (r) => r.real_opc, kind: "flujo", key: "ro" })}
            {line({ lbl: "Forex", f: (r) => r.real_fx, kind: "flujo", key: "rf" })}
            {line({ lbl: "Bonos", f: (r) => r.real_bono, kind: "flujo", key: "rb" })}
            {line({ lbl: "Subtotal realizada", f: fReal, kind: "flujo", key: "real", tot: true })}
            {sec("3 · No realizada (saldo de cierre, no suma)")}
            {line({ lbl: "Subtotal no realizada", f: fNR, kind: "cierre", key: "nr" })}
            {sec("4 · Costos")}
            {line({ lbl: "Comisiones", f: (r) => r.comisiones, kind: "flujo", key: "cm" })}
            {line({ lbl: "Interés bróker", f: (r) => r.int_broker, kind: "flujo", key: "ib" })}
            {sec("5 · NAV y depósitos")}
            {line({ lbl: "NAV total (cierre)", f: (r) => r.nav_final, kind: "cierre", key: "nav" })}
            {line({ lbl: "Depósitos netos", f: (r) => r.depositos, kind: "flujo", key: "dep" })}
            {sec("TC FIX usado")}
            <tr><td>MXN/USD</td>{MESN.map((_, i) => <td key={i} className={"n" + (tcReal(year, i + 1) ? "" : " neg")} title={tcReal(year, i + 1) ? "FIX del mes" : "sin FIX: usa el último conocido"}>{tcOf(year, i + 1) ? tcOf(year, i + 1).toFixed(4) + (tcReal(year, i + 1) ? "" : "*") : "—"}</td>)}<td /></tr>
          </tbody>
        </table></div>
        {drill && <div className="note">{drill}</div>}
      </div>

      <div className="g2">
        <div className="card">
          <div className="ct">Impuestos {year} · {mode === "usd" ? "USD" : "MXN"}</div>
          <div className="tbl"><table><tbody>
            <tr><td>Dividendos brutos</td><td className="n">{vfmt(divB)}</td></tr>
            <tr><td>ISR 10 % sobre dividendos (art. 142 fr. V)</td><td className="n">{vfmt(divB * 0.1)}</td></tr>
            <tr><td>Retenido en EE. UU. (acreditable)</td><td className="n">−{vfmt(divR)}</td></tr>
            <tr><td>Cupones cobrados</td><td className="n">{vfmt(cup)}</td></tr>
            <tr><td>ISR 35 % sobre cupones (art. 143)</td><td className="n">{vfmt(cup * 0.35)}</td></tr>
            <tr className="tot"><td>ISR estimado del año</td><td className="n">{vfmt(Math.max(0, divB * 0.1 - divR) + cup * 0.35)}</td></tr>
            <tr><td>Realizada del año (anual, Cap. IV)</td><td className={"n" + (real < 0 ? " neg" : "")}>{vfmt(real)}</td></tr>
            <tr><td>{real < 0 ? "Pérdida compensable hasta" : "Ganancia gravable"}</td><td className="n">{real < 0 ? year + 3 : "35 % marginal"}</td></tr>
          </tbody></table></div>
        </div>
        <div className="card">
          <div className="ct"><span>Tipo de cambio FIX · {year}</span>
            <button className="btn ghost sm" type="button" onClick={traerBanxico} disabled={busy || !initial.banxico} title={initial.banxico ? "Trae el cierre de cada mes de Banxico" : "Configura BANXICO_TOKEN en Vercel"}>⟳ Traer de Banxico</button></div>
          <div className="tbl"><table><tbody>
            {[0, 6].map((o) => (
              <Fragment key={o}>
                <tr>{MESN.slice(o, o + 6).map((m) => <th key={m} className="n">{m}</th>)}</tr>
                <tr>{[1, 2, 3, 4, 5, 6].map((i) => { const m = o + i; return <td key={m} className="n"><input type="number" step="0.0001" defaultValue={tcReal(year, m) || ""} style={{ width: 78, padding: "4px 6px", fontSize: 12, textAlign: "right" }} onBlur={(e) => { const v = +e.target.value || 0; if (v !== (tcReal(year, m) || 0)) guardarTc(m, v); }} /></td>; })}</tr>
              </Fragment>
            ))}
          </tbody></table></div>
          <p className="hint">* = mes sin FIX; se usa el último conocido para que no salga en cero. {initial.banxico ? "Banxico guarda el FIX del último día hábil de cada mes." : "Sin BANXICO_TOKEN en Vercel el botón está apagado; puedes capturar a mano."}</p>
        </div>
      </div>

      <div className="card">
        <div className="ct">Consolidado anual · {mode === "usd" ? "USD" : "MXN"}</div>
        <div className="tbl"><table>
          <thead><tr><th>Cuenta / año</th><th className="n">Realizada</th><th className="n">No realizada</th><th className="n">Pasivos</th><th className="n">Costos</th><th className="n">Neto inv.</th><th className="n">NAV cierre</th><th className="n">Depósitos</th></tr></thead>
          <tbody>{rows2.map(({ c, y }) => { const R = flujo(c.id, y, fReal).v, N = cierre(c.id, y, fNR).v, Pp = flujo(c.id, y, fPas).v, K = flujo(c.id, y, fCost).v; return (
            <tr key={c.id + y}><td>{nombre(c)} · {y}</td><td className={"n" + (R < 0 ? " neg" : "")}>{vfmt(R)}</td><td className={"n" + (N < 0 ? " neg" : "")}>{vfmt(N)}</td><td className="n">{vfmt(Pp)}</td><td className="n neg">{vfmt(K)}</td><td className={"n " + (R + N + Pp + K < 0 ? "neg" : "pos")} style={{ fontWeight: 700 }}>{vfmt(R + N + Pp + K)}</td><td className="n">{vfmt(cierre(c.id, y, (r) => r.nav_final).v)}</td><td className="n">{vfmt(flujo(c.id, y, (r) => r.depositos).v)}</td></tr>); })}</tbody>
        </table></div>
      </div>

      <div className="g2">
        <div className="card">
          <div className="ct">Ahorro para el retiro y saldos</div>
          {retiro.map((c) => (
            <div key={c.id} className="mov"><span><b style={{ color: "var(--ink)" }}>{c.nombre}</b> <span style={{ color: "var(--gray-soft)", fontSize: 12 }}>{c.fecha ? `al ${c.fecha}` : "sin saldo"}{c.fuente ? ` · ${c.fuente}` : ""}</span></span>
              <span className="r"><b style={{ color: "var(--ink)" }}>{c.saldo == null ? "—" : c.moneda === "USD" ? usd(c.saldo) : fmt(c.saldo)}</b></span></div>
          ))}
          <div className="g3" style={{ marginTop: 8 }}>
            <div><label htmlFor="s-cta">Actualizar</label><select id="s-cta" value={sCta} onChange={(e) => setSCta(e.target.value)}>{retiro.filter((c) => c.tipo === "retiro").map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
            <div><label htmlFor="s-saldo">Saldo</label><input id="s-saldo" type="number" inputMode="decimal" value={sSaldo} onChange={(e) => setSSaldo(e.target.value)} /></div>
            <div><label htmlFor="s-fecha">Fecha</label><input id="s-fecha" type="date" value={sFecha} onChange={(e) => setSFecha(e.target.value)} /></div>
          </div>
          <div className="center">
            <button className="btn ghost sm" type="button" onClick={guardarSaldo}>Guardar saldo</button>
            {initial.flexHoy && <button className="btn sm" type="button" style={{ marginLeft: 8 }} onClick={() => traerFlex(true)} disabled={busy}>⟳ Actualizar NAV de hoy (IBKR)</button>}
          </div>
          <p className="hint">AFORE y PPR se actualizan a mano con el estado de cuenta. IBKR: {initial.flexHoy ? "el botón trae el NAV al día desde IBKR (query Month to Date) y guarda el mes en curso como parcial." : initial.flex ? "se actualiza al traer el mes; para el NAV de hoy agrega IBKR_FLEX_QUERY_MTD (query Month to Date)." : "se actualiza al subir el CSV."}</p>
        </div>
        <div className="card">
          <div className="ct">Net worth personal · hoy</div>
          {nw ? (
            <div className="tbl"><table><tbody>
              <tr><td>Retiro + inversión (tuya)</td><td className="n">{fmt(nw.retiro_inversion_mxn)}</td></tr>
              <tr><td>Efectivo (Cheques)</td><td className="n">{fmt(nw.efectivo_mxn)}</td></tr>
              <tr><td>Tarjetas</td><td className="n neg">−{fmt(nw.tarjetas_mxn)}</td></tr>
              <tr><td>Préstamos (Santander, Revolut, FIDERH)</td><td className="n neg">−{fmt(nw.prestamos_mxn)}</td></tr>
              <tr className="tot"><td>Neto</td><td className={"n " + (nw.neto_mxn < 0 ? "neg" : "pos")}>{fmt(nw.neto_mxn)}</td></tr>
            </tbody></table></div>
          ) : <p className="hint">Sin datos.</p>}
          <p className="hint">Excluye CBZBurguer y el Fondo Akela (son de tus papás). USD al TC más reciente capturado. Proyección a futuro en Analíticas.</p>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
