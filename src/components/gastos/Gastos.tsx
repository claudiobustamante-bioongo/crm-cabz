"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Asignacion, CfdiMini, Clasificacion, GastosData, Movimiento, Presupuesto, Rubro } from "@/lib/types";
import { Buscador } from "@/components/Buscador";
import { CLS_COLOR, CLS_LABEL, color, cuentaColor, fmt, hoy, mesKey, ml, slug } from "@/lib/format";
import { Formulario, type NuevoGasto } from "./Formulario";
import { BarrasMes, Dona } from "./Graficas";

const MOV_COLS = "id,fecha,mes,tipo,estado,descripcion,monto,monto_mxn,moneda,cuenta,cuenta_id,grupo,grupo_codigo,rubro,rubro_id,rubro_codigo,evento,notas,cfdi_uuid";

export function Gastos({ initial }: { initial: GastosData }) {
  const router = useRouter();
  const supabase = createClient();
  const [movs, setMovs] = useState<Movimiento[]>(initial.movimientos);
  const [asigs, setAsigs] = useState<Asignacion[]>(initial.asignaciones);
  const [rubros, setRubros] = useState<Rubro[]>(initial.rubros);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [fmes, setFmes] = useState<string>(() => {
    const ks = [...new Set(initial.movimientos.filter((m) => m.estado === "real").map((m) => mesKey(m.fecha)))].sort();
    return ks.at(-1) ?? "all";
  });
  const [fcta, setFcta] = useState("");
  const [selCat, setSelCat] = useState("");

  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 3500); };
  /* caja del mes: saldo en cheques + lo que falta por entrar − lo que falta por gastar (presupuesto − real) → cómo cierra el mes */
  const [pptos, setPptos] = useState<Presupuesto[]>(initial.presupuestos);
  const CajaMes = () => {
    const mesHoy = hoy().slice(0, 7);
    const [mes, setMes] = useState(() => { const sig = new Date(); sig.setDate(1); const k = sig.toISOString().slice(0, 7); return k.startsWith(String(initial.anio)) ? k : `${initial.anio}-01`; });
    const [abierto, setAbierto] = useState(true);
    const [add, setAdd] = useState({ rubro_id: "", monto: "" });
    const [libro, setLibro] = useState("PERSONAL");
    const efectivo = initial.saldos.filter((c) => c.tipo === "cheques" && c.moneda === "MXN").reduce((a, c) => a + c.saldo, 0);
    const tarjetasDeuda = -initial.saldos.filter((c) => c.tipo === "tarjeta_credito").reduce((a, c) => a + Math.min(0, c.saldo), 0);
    const ingM = initial.ingresosMes.filter((i) => i.mes === mes); const entradasReal = ingM.filter((i) => !i.proyectado).reduce((a, i) => a + i.monto_mxn, 0), entradasProy = ingM.filter((i) => i.proyectado).reduce((a, i) => a + i.monto_mxn, 0);
    const realMes = (rid: string) => movs.filter((m) => m.estado === "real" && m.tipo === "gasto" && m.rubro_id === rid && mesKey(m.fecha) === mes).reduce((a, m) => a + m.monto_mxn, 0);
    const realTotalMes = movs.filter((m) => m.estado === "real" && ["gasto", "abono_deuda", "ahorro"].includes(m.tipo) && mesKey(m.fecha) === mes).reduce((a, m) => a + m.monto_mxn, 0);
    const lineas = pptos.filter((p) => p.mes === mes).map((p) => { const r = rubros.find((x) => x.id === p.rubro_id); const g = r?.padre_id ? rubros.find((x) => x.id === r.padre_id) : null; const real = realMes(p.rubro_id); return { ...p, nombre: r?.nombre ?? "?", grupo: g?.nombre ?? r?.nombre ?? "?", real, resta: Math.max(0, p.monto - real) }; }).sort((a, b) => a.grupo.localeCompare(b.grupo, "es") || b.monto - a.monto);
    const pptoTotal = lineas.reduce((a, l) => a + l.monto, 0), restaTotal = lineas.reduce((a, l) => a + l.resta, 0), realEnPpto = lineas.reduce((a, l) => a + l.real, 0);
    const sinPpto = realTotalMes - realEnPpto;   // gastos del mes en rubros que no están presupuestados
    const esActualOFuturo = mes >= mesHoy;
    const cierre = esActualOFuturo ? efectivo + entradasProy - restaTotal : null;
    const guardarPpto = async (p: Presupuesto, monto: number) => { const { error } = await supabase.from("presupuestos").update({ monto }).eq("id", p.id); if (error) return aviso(error.message); setPptos((prev) => prev.map((x) => x.id === p.id ? { ...x, monto } : x)); };
    const borrarPpto = async (p: Presupuesto) => { const { error } = await supabase.from("presupuestos").delete().eq("id", p.id); if (error) return aviso(error.message); setPptos((prev) => prev.filter((x) => x.id !== p.id)); };
    const agregarPpto = async () => {
      const monto = Number(add.monto); if (!add.rubro_id || !(monto >= 0)) return aviso("Rubro y monto.");
      const { data: lb } = await supabase.from("libros").select("id").eq("codigo", libro).single(); const { data: pg } = await supabase.from("pagadores").select("id").eq("codigo", "CABZ").single();
      const { data, error } = await supabase.from("presupuestos").upsert({ mes: `${mes}-01`, libro_id: lb?.id, rubro_id: add.rubro_id, pagador_id: pg?.id, monto }, { onConflict: "user_id,mes,libro_id,rubro_id,pagador_id" }).select("id,mes,rubro_id,monto,notas").single();
      if (error) return aviso(error.message);
      setPptos((prev) => [...prev.filter((x) => x.id !== data.id), { id: data.id, mes, rubro_id: add.rubro_id, monto, notas: null, libro }]); setAdd({ rubro_id: "", monto: "" });
    };
    const copiarDe = async (origen: string) => {
      const src = pptos.filter((p) => p.mes === origen); if (!src.length) return aviso(`No hay presupuesto en ${ml(origen)}.`);
      if (!confirm(`Copiar ${src.length} líneas de ${ml(origen)} a ${ml(mes)}? (no borra lo que ya tengas)`)) return;
      setBusy(true); const { data: pg } = await supabase.from("pagadores").select("id").eq("codigo", "CABZ").single(); const { data: lbs } = await supabase.from("libros").select("id,codigo") as { data: { id: string; codigo: string }[] | null };
      for (const p of src) { if (pptos.some((x) => x.mes === mes && x.rubro_id === p.rubro_id && x.libro === p.libro)) continue; const { data } = await supabase.from("presupuestos").upsert({ mes: `${mes}-01`, libro_id: lbs?.find((l) => l.codigo === p.libro)?.id, rubro_id: p.rubro_id, pagador_id: pg?.id, monto: p.monto }, { onConflict: "user_id,mes,libro_id,rubro_id,pagador_id" }).select("id").single(); if (data) setPptos((prev) => [...prev, { ...p, id: data.id, mes }]); }
      setBusy(false); aviso("Copiado.");
    };
    const mesesOpc = Array.from({ length: 12 }, (_, i) => `${initial.anio}-${String(i + 1).padStart(2, "0")}`);
    const otros = [...new Set(pptos.map((p) => p.mes))].filter((m) => m !== mes).sort().reverse();
    return (
      <div className="card">
        <div className="ct"><span>Caja del mes · ¿cómo cierro?</span><span style={{ display: "flex", gap: 8, alignItems: "center" }}><select value={mes} onChange={(e) => setMes(e.target.value)}>{mesesOpc.map((k) => <option key={k} value={k}>{ml(k)}</option>)}</select><button className="link" type="button" onClick={() => setAbierto(!abierto)}>{abierto ? "ocultar detalle" : "ver detalle"}</button></span></div>
        <div className="stat-row">
          <div className="stat"><div className="v">{fmt(efectivo)}</div><div className="l">En cheques hoy{tarjetasDeuda ? ` · tarjetas por pagar ${fmt(tarjetasDeuda)}` : ""}</div></div>
          <div className="stat"><div className="v pos">{fmt(entradasReal + entradasProy)}</div><div className="l">Entradas del mes · {fmt(entradasReal)} ya entraron{entradasProy ? ` · ${fmt(entradasProy)} por entrar` : ""}</div></div>
          <div className="stat"><div className="v">{fmt(pptoTotal)}</div><div className="l">Gastos esperados · ya gastado {fmt(realEnPpto)}{sinPpto > 0 ? ` (+${fmt(sinPpto)} fuera de presupuesto)` : ""} · falta {fmt(restaTotal)}</div></div>
          <div className="stat"><div className={"v " + (cierre == null ? "" : cierre >= 0 ? "pos" : "neg")}>{cierre == null ? "—" : fmt(cierre)}</div><div className="l">{cierre == null ? "Mes cerrado" : cierre >= 0 ? "Cierre estimado: te sobra" : "Cierre estimado: te falta"} · cheques + por entrar − por gastar</div></div>
        </div>
        {abierto && <>
          <div className="tbl"><table style={{ fontSize: 12.5 }}>
            <thead><tr><th>Rubro</th><th>Concepto</th><th className="n">Esperado</th><th className="n">Real</th><th className="n">Falta</th><th style={{ width: 120 }}>Avance</th><th></th></tr></thead>
            <tbody>
              {lineas.map((l) => <tr key={l.id}><td className="hint">{l.grupo}</td><td style={{ fontWeight: 600, color: "var(--ink)" }}>{l.nombre}{l.libro !== "PERSONAL" ? <span className="badge" style={{ marginLeft: 6 }}>{l.libro}</span> : null}</td>
                <td className="n"><input type="number" defaultValue={l.monto || ""} onBlur={(e) => Number(e.target.value) !== l.monto && guardarPpto(l, Number(e.target.value) || 0)} style={{ width: 96, textAlign: "right", padding: "2px 4px" }} /></td>
                <td className={"n" + (l.real > l.monto && l.monto ? " neg" : "")}>{l.real ? fmt(l.real) : "·"}</td><td className="n">{l.resta ? fmt(l.resta) : "✓"}</td>
                <td><div style={{ height: 10, border: "1px solid var(--ink)", borderRadius: 5, background: "var(--cream)", overflow: "hidden" }}><div style={{ width: `${l.monto ? Math.min(100, (l.real / l.monto) * 100) : 0}%`, height: "100%", background: l.real > l.monto ? "var(--deu)" : "var(--aho)" }} /></div></td>
                <td><button className="del" type="button" onClick={() => borrarPpto(l)}>✕</button></td></tr>)}
              {!lineas.length && <tr><td colSpan={7} className="hint">Sin presupuesto para {ml(mes)}. Agrega líneas abajo o copia de otro mes.</td></tr>}
              <tr className="tot"><td colSpan={2}>Total</td><td className="n">{fmt(pptoTotal)}</td><td className="n">{fmt(realEnPpto)}</td><td className="n">{fmt(restaTotal)}</td><td colSpan={2} /></tr>
            </tbody>
          </table></div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
            <div><label style={{ margin: "0 0 2px" }}>Agregar rubro</label><select value={add.rubro_id} onChange={(e) => setAdd({ ...add, rubro_id: e.target.value })}><option value="">—</option>{rubros.filter((r) => !r.padre_id).map((g) => <optgroup key={g.id} label={g.nombre}>{rubros.filter((r) => r.padre_id === g.id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</optgroup>)}</select></div>
            <div><label style={{ margin: "0 0 2px" }}>Libro</label><select value={libro} onChange={(e) => setLibro(e.target.value)}>{initial.libros.map((l) => <option key={l.codigo} value={l.codigo}>{l.codigo}</option>)}</select></div>
            <div><label style={{ margin: "0 0 2px" }}>Esperado</label><input type="number" value={add.monto} onChange={(e) => setAdd({ ...add, monto: e.target.value })} style={{ width: 110 }} onKeyDown={(e) => e.key === "Enter" && agregarPpto()} /></div>
            <button className="btn sm" type="button" onClick={agregarPpto} disabled={busy}>+</button>
            {otros.length > 0 && <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>copiar de <select onChange={(e) => { if (e.target.value) copiarDe(e.target.value); e.target.value = ""; }} defaultValue=""><option value="">mes…</option>{otros.map((m) => <option key={m} value={m}>{ml(m)}</option>)}</select></span>}
          </div>
          <p className="hint">Esperado = lo que piensas gastar en el mes por rubro; Real = lo registrado (cualquier cuenta); Falta = lo que aún no sale. El cierre asume que lo que falta se paga este mes desde cheques (los cargos a tarjeta se pagan al corte).</p>
        </>}
      </div>);
  };
  /* cierre de saldos: fija el saldo real de cheques y tarjetas a una fecha; desde ahí el CRM suma solo lo nuevo */
  const CierreSaldos = () => {
    const [abierto, setAbierto] = useState(false);
    const [fecha, setFecha] = useState(hoy());
    const [vals, setVals] = useState<Record<string, string>>({});
    const guardar = async () => {
      const cambios = initial.saldos.filter((c) => vals[c.id] !== undefined && vals[c.id] !== "");
      if (!cambios.length) return aviso("Escribe al menos un saldo.");
      setBusy(true);
      for (const c of cambios) { const v = Number(vals[c.id]); const saldo = c.tipo === "tarjeta_credito" ? -Math.abs(v) : v; const { error } = await supabase.from("cuentas").update({ saldo_inicial: saldo, fecha_saldo_inicial: fecha }).eq("id", c.id); if (error) { setBusy(false); return aviso("No se guardó: " + error.message); } }
      setBusy(false); aviso(`Saldos fijados al ${fecha}. Lo registrado después de esa fecha se suma; lo anterior ya no mueve el saldo.`); router.refresh(); setVals({}); setAbierto(false);
    };
    return (
      <div className="card" style={{ padding: abierto ? undefined : "8px 14px" }}>
        <div className="ct" style={{ marginBottom: abierto ? undefined : 0 }}><span>Cierre de saldos · cheques y tarjetas</span><button className="link" type="button" onClick={() => setAbierto(!abierto)}>{abierto ? "cerrar" : "fijar saldos reales"}</button></div>
        {abierto && <>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 6 }}><div><label style={{ margin: "0 0 2px" }}>Saldos al día</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div><span className="hint">Escribe solo los que quieras fijar. Tarjetas: lo que debes hoy (positivo; 0 si ya la pagaste).</span></div>
          <div className="tbl"><table style={{ fontSize: 12.5 }}>
            <thead><tr><th>Cuenta</th><th className="n">Según el CRM</th><th className="n">Saldo real</th><th>Último cierre</th></tr></thead>
            <tbody>{initial.saldos.map((c) => <tr key={c.id}><td>{c.nombre} <span className="hint">{c.tipo === "tarjeta_credito" ? "tarjeta" : c.moneda}</span></td><td className={"n" + (c.saldo < 0 ? " neg" : "")}>{fmt(c.saldo)}</td><td className="n"><input type="number" placeholder={c.tipo === "tarjeta_credito" ? "deuda" : "saldo"} value={vals[c.id] ?? ""} onChange={(e) => setVals({ ...vals, [c.id]: e.target.value })} style={{ width: 120, textAlign: "right" }} /></td><td className="hint">{c.fecha_saldo_inicial ?? "—"}</td></tr>)}</tbody>
          </table></div>
          <div className="center" style={{ marginTop: 6 }}><button className="btn sm" type="button" disabled={busy} onClick={guardar}>Fijar saldos</button></div>
        </>}
      </div>);
  };
  /* pago de tarjeta = transferencia cheques → tarjeta (los gastos ya están cargados a la tarjeta; aquí no se duplica nada) */
  const PagoTarjeta = () => {
    const tarjetas = initial.cuentas.filter((c) => c.tipo === "tarjeta_credito"), origenes = initial.cuentas.filter((c) => c.tipo === "cheques");
    const [f, setF] = useState({ fecha: hoy(), desde: origenes.find((c) => /cheques/i.test(c.nombre))?.id ?? origenes[0]?.id ?? "", tarjeta: tarjetas[0]?.id ?? "", monto: "", abierto: false });
    if (!tarjetas.length) return null;
    const pagar = async () => {
      const m = Number(f.monto); if (!(m > 0)) return aviso("Monto del pago.");
      setBusy(true);
      const { error } = await supabase.rpc("registrar_movimiento", { p: { fecha: f.fecha, tipo: "transferencia", cuenta_id: f.desde, cuenta_destino_id: f.tarjeta, monto: m, moneda: "MXN", descripcion: `Pago ${tarjetas.find((t) => t.id === f.tarjeta)?.nombre ?? "tarjeta"}` } });
      setBusy(false);
      if (error) return aviso("No se registró: " + error.message);
      aviso(`Pago de ${fmt(m)} a ${tarjetas.find((t) => t.id === f.tarjeta)?.nombre}: baja Cheques y sube la tarjeta; no cuenta como gasto.`); setF({ ...f, monto: "", abierto: false }); router.refresh();
    };
    return (
      <div className="card" style={{ padding: f.abierto ? undefined : "8px 14px" }}>
        <div className="ct" style={{ marginBottom: f.abierto ? undefined : 0 }}><span>Pagar tarjeta</span><button className="link" type="button" onClick={() => setF({ ...f, abierto: !f.abierto })}>{f.abierto ? "cerrar" : "registrar pago"}</button></div>
        {f.abierto && <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div><label style={{ margin: "0 0 2px" }}>Fecha</label><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
          <div><label style={{ margin: "0 0 2px" }}>Desde</label><select value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })}>{origenes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
          <div><label style={{ margin: "0 0 2px" }}>Tarjeta</label><select value={f.tarjeta} onChange={(e) => setF({ ...f, tarjeta: e.target.value })}>{tarjetas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
          <div><label style={{ margin: "0 0 2px" }}>Monto</label><input type="number" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} style={{ width: 130 }} onKeyDown={(e) => e.key === "Enter" && pagar()} /></div>
          <button className="btn sm" type="button" disabled={busy} onClick={pagar}>Pagar</button>
          <span className="hint" style={{ flexBasis: "100%" }}>Es una transferencia Cheques → tarjeta: los gastos ya se registraron cuando se cargaron a la tarjeta, así que el pago no se cuenta otra vez.</span>
        </div>}
      </div>);
  };
  const clsDe = (grupo: string) => rubros.find((r) => !r.padre_id && r.nombre === grupo)?.clasificacion ?? "G";
  const asigDe = (id: string) => asigs.filter((a) => a.movimiento_id === id);

  /* ---------- derivados ---------- */
  const reales = useMemo(() => movs.filter((m) => m.estado === "real"), [movs]);
  const meses = useMemo(() => [...new Set(reales.map((m) => mesKey(m.fecha)))].sort(), [reales]);
  const V = useMemo(
    () => reales.filter((m) => (fmes === "all" || mesKey(m.fecha) === fmes) && (!fcta || m.cuenta === fcta)),
    [reales, fmes, fcta],
  );
  const tot = V.reduce((a, m) => a + m.monto_mxn, 0);
  const nM = fmes === "all" ? new Set(V.map((m) => mesKey(m.fecha))).size || 1 : 1;
  const porCuenta = V.reduce<Record<string, number>>((o, m) => ((o[m.cuenta] = (o[m.cuenta] ?? 0) + m.monto_mxn), o), {});
  const medios = initial.cuentas.filter((c) => c.es_medio_pago).map((c) => c.nombre);
  const cats = useMemo(
    () => Object.entries(V.reduce<Record<string, number>>((o, m) => ((o[m.grupo] = (o[m.grupo] ?? 0) + m.monto_mxn), o), {})).sort((a, b) => b[1] - a[1]) as [string, number][],
    [V],
  );
  const mxCat = cats[0]?.[1] ?? 1;
  const porCls = V.reduce<Record<string, number>>((o, m) => { const c = clsDe(m.grupo); o[c] = (o[c] ?? 0) + m.monto_mxn; return o; }, {});

  // base del mes-a-mes: todos los meses del año, filtrados por cuenta y rubro seleccionado
  const base = useMemo(() => reales.filter((m) => (!fcta || m.cuenta === fcta) && (!selCat || m.grupo === selCat)), [reales, fcta, selCat]);
  const matriz = useMemo(() => {
    const d: Record<string, Record<string, number>> = {};
    base.forEach((m) => { const k = mesKey(m.fecha); (d[k] ??= {})[m.grupo] = (d[k][m.grupo] ?? 0) + m.monto_mxn; });
    return d;
  }, [base]);
  const rubrosT = useMemo(() => {
    const t: Record<string, number> = {};
    base.forEach((m) => (t[m.grupo] = (t[m.grupo] ?? 0) + m.monto_mxn));
    return Object.keys(t).sort((a, b) => t[b] - t[a]);
  }, [base]);
  const subsSel = useMemo(() => {
    if (!selCat) return [] as [string, number][];
    const sv = V.filter((m) => m.grupo === selCat);
    return Object.entries(sv.reduce<Record<string, number>>((o, m) => ((o[m.rubro] = (o[m.rubro] ?? 0) + m.monto_mxn), o), {})).sort((a, b) => b[1] - a[1]) as [string, number][];
  }, [V, selCat]);
  const subTot = subsSel.reduce((a, x) => a + x[1], 0);

  const lista = useMemo(() => {
    const L = movs.filter((m) => (fmes === "all" || mesKey(m.fecha) === fmes) && (!fcta || m.cuenta === fcta) && (!selCat || m.grupo === selCat));
    return L.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.monto_mxn - a.monto_mxn);
  }, [movs, fmes, fcta, selCat]);
  const listaTot = lista.filter((m) => m.estado === "real").reduce((a, m) => a + m.monto_mxn, 0);

  /* ---------- acciones ---------- */
  const refetchMov = async (ids: string[]) => {
    const [m, a] = await Promise.all([
      supabase.from("v_movimientos").select(MOV_COLS).in("id", ids),
      supabase.from("v_asignaciones").select("movimiento_id,libro,pagador,monto").in("movimiento_id", ids),
    ]);
    if (m.error) throw m.error;
    setMovs((prev) => [...(m.data as Movimiento[]), ...prev]);
    setAsigs((prev) => [...prev, ...((a.data ?? []) as Asignacion[])]);
  };

  const agregar = async (g: NuevoGasto) => {
    setBusy(true);
    try {
      const [y, m0] = [+g.fecha.slice(0, 4), +g.fecha.slice(5, 7)];
      const dia = +g.fecha.slice(8, 10);
      // fecha del mes i a partir de la compra (si el día no existe en ese mes, usa el último)
      const fechaMes = (i: number) => { const d = new Date(Date.UTC(y, m0 - 1 + i, 1)); const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(dia, ult)).padStart(2, "0")}`; };
      const n = g.msi > 0 ? g.msi : g.repetir ? 13 - m0 : 1;
      const fechas = Array.from({ length: n }, (_, i) => fechaMes(i));
      const cuota = g.msi > 0 ? Math.round((g.monto / g.msi) * 100) / 100 : g.monto;
      const ids: string[] = [];
      for (const [i, f] of fechas.entries()) {
        const monto = g.msi > 0 && i === n - 1 ? Math.round((g.monto - cuota * (n - 1)) * 100) / 100 : cuota;   // la última absorbe el redondeo
        const notaMsi = g.msi > 0 ? `MSI ${i + 1}/${g.msi} · total ${fmt(g.monto)}` : "";
        const p = {
          fecha: f, tipo: "gasto", descripcion: g.rubro.nombre, monto, cuenta_id: g.cuenta.id, rubro_id: g.rubro.id,
          evento_id: g.evento, notas: [g.nota, notaMsi].filter(Boolean).join(" · ") || null,
          estado: g.repetir && i > 0 ? "presupuesto" : "real",
          asignaciones: [{ libro: g.libro, pagador: g.pagador, porcentaje: 100 }],
        };
        const { data, error } = await supabase.rpc("registrar_movimiento", { p });
        if (error) throw error;
        ids.push(data as string);
      }
      await refetchMov(ids);
      setFmes(mesKey(g.fecha)); setSelCat(g.grupo.nombre);
      aviso(`${g.rubro.nombre} ${fmt(g.monto)} → ${g.grupo.nombre} (${g.cuenta.nombre})${g.msi > 0 ? ` · ${g.msi} MSI de ${fmt(cuota)}` : fechas.length > 1 ? ` · ${fechas.length} meses` : ""}`);
      if (+g.fecha.slice(0, 4) !== initial.anio) router.push(`/gastos?anio=${g.fecha.slice(0, 4)}`);
    } catch (e) {
      aviso("No se guardó: " + (e as Error).message);
    } finally { setBusy(false); }
  };

  /* ---------- edición en línea ---------- */
  const [edit, setEdit] = useState<{ id: string; fecha: string; monto: string; cuenta_id: string; rubro_id: string; notas: string; libro: string; pagador: string } | null>(null);
  const empezarEdicion = (m: Movimiento) => { const a = asigDe(m.id); setEdit({ id: m.id, fecha: m.fecha, monto: String(m.monto), cuenta_id: m.cuenta_id ?? "", rubro_id: m.rubro_id ?? "", notas: m.notas ?? "", libro: a.length === 1 ? a[0].libro : "", pagador: a.length === 1 ? a[0].pagador : "" }); };
  const guardarEdicion = async () => {
    if (!edit) return;
    const monto = Number(edit.monto);
    if (!(monto > 0)) return aviso("Monto inválido.");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("editar_movimiento", { p: { id: edit.id, fecha: edit.fecha, monto, cuenta_id: edit.cuenta_id || null, rubro_id: edit.rubro_id || null, notas: edit.notas, libro: edit.libro || null, pagador: edit.pagador || null } });
      if (error) throw error;
      const [m, a] = await Promise.all([
        supabase.from("v_movimientos").select(MOV_COLS).eq("id", edit.id).single(),
        supabase.from("v_asignaciones").select("movimiento_id,libro,pagador,monto").eq("movimiento_id", edit.id),
      ]);
      if (m.data) setMovs((prev) => prev.map((x) => (x.id === edit.id ? (m.data as Movimiento) : x)));
      setAsigs((prev) => [...prev.filter((x) => x.movimiento_id !== edit.id), ...((a.data ?? []) as Asignacion[])]);
      setEdit(null); aviso("Movimiento actualizado.");
    } catch (e) { aviso("No se guardó: " + (e as Error).message); } finally { setBusy(false); }
  };

  /* ---------- ligar factura desde la lista ---------- */
  const [sinLigar, setSinLigar] = useState<CfdiMini[]>(initial.cfdisSinLigar);
  const [ligando, setLigando] = useState<string | null>(null);   // id del movimiento
  const candidatas = (m: Movimiento) => [...sinLigar].sort((a, b) => {
    const da = Math.abs(a.total_mxn - m.monto_mxn) / Math.max(1, m.monto_mxn) + Math.abs(new Date(a.fecha).getTime() - new Date(m.fecha).getTime()) / 8.64e7 / 60;
    const db = Math.abs(b.total_mxn - m.monto_mxn) / Math.max(1, m.monto_mxn) + Math.abs(new Date(b.fecha).getTime() - new Date(m.fecha).getTime()) / 8.64e7 / 60;
    return da - db;
  });
  const [nFact, setNFact] = useState<Record<string, number>>(initial.facturasPorMov);
  const ligar = async (m: Movimiento, uuid: string) => {
    const { error } = await supabase.rpc("ligar_cfdi", { p_uuid: uuid, p_mov: m.id });
    if (error) return aviso("No se ligó: " + error.message + (/function/i.test(error.message) ? " (corre 28_varias_facturas.sql)" : ""));
    setMovs((prev) => prev.map((x) => (x.id === m.id ? { ...x, cfdi_uuid: x.cfdi_uuid ?? uuid } : x)));
    setNFact((p) => ({ ...p, [m.id]: (p[m.id] ?? 0) + 1 }));
    setSinLigar((prev) => prev.filter((c) => c.uuid !== uuid)); setLigando(null);
    aviso("Factura ligada al gasto.");
  };
  const desligarTodas = async (m: Movimiento) => {
    const { data } = await supabase.from("cfdi").select("uuid").eq("movimiento_id", m.id);
    const uuids = [...new Set([...((data ?? []) as { uuid: string }[]).map((c) => c.uuid), ...(m.cfdi_uuid ? [m.cfdi_uuid] : [])])];
    if (!uuids.length || !confirm(`¿Desligar ${uuids.length} factura${uuids.length === 1 ? "" : "s"} de este gasto?`)) return;
    for (const u of uuids) { const { error } = await supabase.rpc("desligar_cfdi", { p_uuid: u }); if (error) return aviso("No se desligó: " + error.message); }
    setMovs((prev) => prev.map((x) => (x.id === m.id ? { ...x, cfdi_uuid: null } : x)));
    setNFact((p) => ({ ...p, [m.id]: 0 })); router.refresh();
  };

  const borrar = async (m: Movimiento) => {
    if (!confirm(`¿Borrar ${m.rubro} ${fmt(m.monto_mxn)} del ${m.fecha}?`)) return;
    const { error } = await supabase.from("movimientos").delete().eq("id", m.id);
    if (error) return aviso("No se borró: " + error.message);
    setMovs((prev) => prev.filter((x) => x.id !== m.id));
    setAsigs((prev) => prev.filter((x) => x.movimiento_id !== m.id));
  };

  const nuevoRubro = async (nombre: string, cls: Clasificacion, padre: Rubro | null) => {
    const codigo = padre ? `${padre.codigo}__${slug(nombre)}` : slug(nombre);
    const row = { codigo, nombre, naturaleza: "gasto", padre_id: padre?.id ?? null, clasificacion: padre && cls === padre.clasificacion ? null : cls, orden: 999 };
    const { data, error } = await supabase.from("rubros").insert(row).select("id,codigo,nombre,padre_id,clasificacion,emoji,activo").single();
    if (error) { aviso("No se creó: " + error.message); return null; }
    setRubros((prev) => [...prev, data as Rubro]);
    aviso(`"${nombre}" creado.`);
    return data as Rubro;
  };

  /* ---------- UI ---------- */
  return (
    <section>
      <div className="idea"><b>Cómo funciona</b>Eliges <em>rubro</em> y <em>subrubro</em>, dices con qué pagaste y cuánto. Abajo el mes se reordena: cuánto llevas, porcentaje por rubro, y cada movimiento con su etiqueta. {initial.anio}: {reales.length} movimientos reales cargados.</div>

      <Formulario rubros={rubros} cuentas={initial.cuentas} libros={initial.libros} pagadores={initial.pagadores} eventos={initial.eventos} busy={busy} onAgregar={agregar} onNuevoRubro={nuevoRubro} />
      <CajaMes />
      <PagoTarjeta />
      <CierreSaldos />

      <h2>Tu mes en números</h2>
      <div className="g3" style={{ marginBottom: 6 }}>
        <div><label htmlFor="f-anio">Año</label>
          <select id="f-anio" value={initial.anio} onChange={(e) => router.push(`/gastos?anio=${e.target.value}`)}>
            {initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></div>
        <div><label htmlFor="f-mes">Ver</label>
          <select id="f-mes" value={fmes} onChange={(e) => setFmes(e.target.value)}>
            <option value="all">Todo {initial.anio}</option>
            {meses.map((k) => <option key={k} value={k}>{ml(k)}</option>)}
          </select></div>
        <div><label htmlFor="f-cta">Cuenta</label>
          <select id="f-cta" value={fcta} onChange={(e) => setFcta(e.target.value)}>
            <option value="">Todas</option>
            {medios.map((c) => <option key={c}>{c}</option>)}
          </select></div>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="v">{fmt(tot)}</div><div className="l">Gastado{nM > 1 ? ` · ${fmt(tot / nM)}/mes` : ""}</div></div>
        {medios.map((x) => (
          <div className="stat" key={x}><div className="v">{fmt(porCuenta[x] ?? 0)}</div><div className="l">{x} · {tot ? Math.round(((porCuenta[x] ?? 0) / tot) * 100) : 0}%</div></div>
        ))}
      </div>
      <div className="stat-row">
        {(["N", "G", "A", "D"] as const).map((c) => (
          <div className="stat" key={c}><div className="v" style={{ color: CLS_COLOR[c] }}>{tot ? Math.round(((porCls[c] ?? 0) / tot) * 100) : 0}%</div><div className="l">{CLS_LABEL[c]} · {fmt(porCls[c] ?? 0)}</div></div>
        ))}
      </div>

      <div className="card">
        <div className="ct"><span>Por rubro</span><span className="tag">{selCat ? "viendo " + selCat : "toca un rubro para ver su detalle"}</span></div>
        <div className="dona-wrap">
          <Dona cats={cats} tot={tot} sel={selCat} />
          <div style={{ flex: 1, minWidth: 260 }}>
            {cats.length === 0 && <p className="hint">Sin gastos en este rango.</p>}
            {cats.map(([c, v]) => (
              <div key={c} className={"catbar" + (c === selCat ? " on" : "")} role="button" tabIndex={0}
                onClick={() => setSelCat(selCat === c ? "" : c)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelCat(selCat === c ? "" : c); } }}>
                <div className="lbl">
                  <span><i style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: color(c), border: "1.5px solid var(--ink)", verticalAlign: -1, marginRight: 6 }} />{c}</span>
                  <span>{fmt(v)} · {tot ? Math.round((v / tot) * 100) : 0}%</span>
                </div>
                <div className="track"><div className="fill" style={{ width: `${(v / mxCat) * 100}%`, background: color(c) }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selCat && (
        <div className="card">
          <div className="ct"><span>{selCat} · {fmt(subTot)} por subrubro</span><button className="btn ghost sm" type="button" onClick={() => setSelCat("")}>Ver todos</button></div>
          {subsSel.map(([x, v]) => (
            <div key={x} className="catbar">
              <div className="lbl"><span>{x}</span><span>{fmt(v)} · {subTot ? Math.round((v / subTot) * 100) : 0}%</span></div>
              <div className="track"><div className="fill" style={{ width: `${(v / (subsSel[0]?.[1] || 1)) * 100}%`, background: color(selCat) }} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="ct"><span>Por mes</span><span className="tag">barras por rubro · sigue tus filtros</span></div>
        <BarrasMes meses={meses} rubros={rubrosT} data={matriz} />
        <div className="tbl" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Rubro</th>{meses.map((k) => <th className="n" key={k}>{ml(k)}</th>)}<th className="n">Total</th><th className="n">/mes</th></tr></thead>
            <tbody>
              {rubrosT.map((rb) => {
                const vals = meses.map((k) => matriz[k]?.[rb] ?? 0), t = vals.reduce((a, b) => a + b, 0);
                return (
                  <tr key={rb}>
                    <td><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: color(rb), border: "1px solid var(--ink)", marginRight: 5 }} />{rb}</td>
                    {vals.map((v, i) => <td key={i} className={"n" + (v ? "" : " dim")}>{v ? fmt(v) : "·"}</td>)}
                    <td className="n" style={{ fontWeight: 700 }}>{fmt(t)}</td><td className="n">{fmt(t / Math.max(1, meses.length))}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td>Total</td>
                {meses.map((k) => <td key={k} className="n">{fmt(Object.values(matriz[k] ?? {}).reduce((a, v) => a + v, 0))}</td>)}
                <td className="n">{fmt(base.reduce((a, m) => a + m.monto_mxn, 0))}</td>
                <td className="n">{fmt(base.reduce((a, m) => a + m.monto_mxn, 0) / Math.max(1, meses.length))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ct"><span>Movimientos</span><span className="tag">{lista.length} movimientos · {fmt(listaTot)}</span></div>
        <div className="tbl">
          <table>
            <thead><tr><th>Concepto</th><th>Subconcepto</th><th>Método de pago</th><th>Fecha</th><th>Libro</th><th>Nota</th><th className="n">Monto</th><th></th></tr></thead>
            <tbody>
              {lista.map((m) => {
                const as = asigDe(m.id);
                if (edit?.id === m.id) {
                  const inp = { padding: "3px 5px", fontSize: 12 } as const;
                  return (
                    <tr key={m.id} style={{ background: "var(--paper-2, #fbf8f1)" }}>
                      <td colSpan={2}><select value={edit.rubro_id} onChange={(e) => setEdit({ ...edit, rubro_id: e.target.value })} style={{ ...inp, width: 210 }}>
                        {rubros.filter((r) => !r.padre_id).map((g) => <optgroup key={g.id} label={g.nombre}>{rubros.filter((r) => r.padre_id === g.id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</optgroup>)}</select></td>
                      <td><select value={edit.cuenta_id} onChange={(e) => setEdit({ ...edit, cuenta_id: e.target.value })} style={{ ...inp, width: 130 }}>{initial.cuentas.filter((c) => c.es_medio_pago || c.id === edit.cuenta_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></td>
                      <td><input type="date" value={edit.fecha} onChange={(e) => setEdit({ ...edit, fecha: e.target.value })} style={{ ...inp, width: 130 }} /></td>
                      <td>{as.length <= 1 ? <span style={{ display: "flex", gap: 4 }}>
                        <select value={edit.libro} onChange={(e) => setEdit({ ...edit, libro: e.target.value })} style={{ ...inp, width: 110 }} aria-label="Libro">{initial.libros.map((l) => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}</select>
                        <select value={edit.pagador} onChange={(e) => setEdit({ ...edit, pagador: e.target.value })} style={{ ...inp, width: 90 }} aria-label="Pagador">{initial.pagadores.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo}</option>)}</select></span>
                        : <span title="Reparto entre varios: se edita borrando y volviendo a registrar">{as.map((a) => `${a.libro}${a.pagador !== "CABZ" ? " · " + a.pagador : ""}`).join(", ")}</span>}</td>
                      <td><input type="text" value={edit.notas} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} style={{ ...inp, width: 160 }} /></td>
                      <td className="n"><input type="number" step="0.01" value={edit.monto} onChange={(e) => setEdit({ ...edit, monto: e.target.value })} style={{ ...inp, width: 100, textAlign: "right" }} /></td>
                      <td style={{ whiteSpace: "nowrap" }}><button className="link" type="button" onClick={guardarEdicion} disabled={busy}>Guardar</button> · <button className="link" type="button" onClick={() => setEdit(null)}>Cancelar</button></td>
                    </tr>
                  );
                }
                return (
                  <tr key={m.id} style={m.estado === "presupuesto" ? { opacity: 0.55 } : undefined}>
                    <td><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: color(m.grupo), border: "1px solid var(--ink)", marginRight: 5 }} />{m.grupo}</td>
                    <td style={{ whiteSpace: "normal" }}>{m.rubro}{m.estado === "presupuesto" && <> <span className="badge" style={{ background: "var(--gray-soft)" }}>presupuesto</span></>}</td>
                    <td><span className="badge" style={{ background: cuentaColor(m.cuenta) }}>{m.cuenta}</span></td>
                    <td>{m.fecha.slice(8, 10)} {ml(m.fecha)}</td>
                    <td>{as.map((a) => `${a.libro}${a.pagador !== "CABZ" ? " · " + a.pagador : ""}`).join(", ") || (m.tipo === "ahorro" ? "ahorro" : m.tipo)}</td>
                    <td style={{ whiteSpace: "normal", color: "var(--gray-soft)" }}>{[m.evento, m.notas].filter(Boolean).join(" · ")}
                      {(nFact[m.id] ?? (m.cfdi_uuid ? 1 : 0)) > 0 && <> {m.notas || m.evento ? "· " : ""}<span className="badge" style={{ background: "var(--aho)" }}>CFDI{(nFact[m.id] ?? 1) > 1 ? ` ×${nFact[m.id]}` : ""}</span> <button className="link" type="button" onClick={() => desligarTodas(m)} style={{ fontSize: 11 }}>desligar</button></>}
                      {ligando === m.id && (
                        <div style={{ marginTop: 4 }}>
                          <Buscador items={candidatas(m)} texto={(c) => `${c.fecha} ${c.emisor_nombre ?? ""} ${c.concepto ?? ""} ${c.total_mxn.toFixed(2)} ${Math.round(c.total_mxn)}`} placeholder={`buscar factura (${sinLigar.length} sin ligar): emisor, concepto, monto…`}
                            render={(c) => <>{c.fecha} · <b>{c.emisor_nombre ?? "?"}</b> · {fmt(c.total_mxn)}{Math.abs(c.total_mxn - m.monto_mxn) < 1 ? " ✓" : ""}<span className="hint"> {c.concepto}</span></>} onElegir={(c) => ligar(m, c.uuid)} />
                          <button className="link" type="button" onClick={() => setLigando(null)}>cancelar</button>
                        </div>)}
                    </td>
                    <td className="n" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmt(m.monto_mxn)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{m.tipo === "gasto" && <><button className="link" type="button" aria-label="Ligar factura" title="Ligar una factura (puede tener varias)" onClick={() => setLigando(ligando === m.id ? null : m.id)}>🔗</button> </>}<button className="link" type="button" aria-label="Editar" title="Editar" onClick={() => empezarEdicion(m)}>✎</button> <button className="del" type="button" aria-label="Borrar" onClick={() => borrar(m)}>✕</button></td>
                  </tr>
                );
              })}
              {lista.length ? (
                <tr className="tot"><td colSpan={6}>Total real</td><td className="n">{fmt(listaTot)}</td><td /></tr>
              ) : (
                <tr><td colSpan={8} className="hint">Sin movimientos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
