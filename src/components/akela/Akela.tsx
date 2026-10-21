"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AkelaData, PlanAkela } from "@/lib/types";
import { fmt, fmt2, MESN, ml } from "@/lib/format";
import { TablaFija } from "@/components/TablaFija";
import { BarrasMes, Dona } from "@/components/gastos/Graficas";
import { color } from "@/lib/format";

const usd = (n: number) => "US$" + Math.round(n).toLocaleString("en-US");

export function Akela({ initial, soloLectura = false }: { initial: AkelaData; soloLectura?: boolean }) {
  const ro = soloLectura;
  const router = useRouter();
  const supabase = createClient();
  const [plan, setPlan] = useState<PlanAkela[]>(initial.plan);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [pr, setPr] = useState(initial.params);
  const [retiroPct, setRetiroPct] = useState(100);   // % del presupuesto anual que saldría del fondo en la proyección
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 4500); };
  const anio = initial.anio;
  const hoy = new Date(); const mesActual = hoy.getFullYear() === anio ? hoy.getMonth() + 1 : hoy.getFullYear() > anio ? 12 : 0;

  /* ---------- plan por línea ---------- */
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const concil = anio <= 2026;   // 2026: el real se captura a mano (conciliación); desde 2027 el real sale de Gastos
  type Linea = { linea: string; pagador: string; transferencia: boolean; rubro_id: string | null; categoria: string | null; subrubro: string | null; anual: boolean; meses: number[]; realCon: (number | null)[] };
  const lineas = useMemo(() => {
    const m = new Map<string, Linea>();
    plan.forEach((p) => {
      const l = m.get(p.linea) ?? { linea: p.linea, pagador: p.pagador, transferencia: p.es_transferencia, rubro_id: p.rubro_id, categoria: p.categoria ?? null, subrubro: p.subrubro ?? null, anual: !!p.anual, meses: Array(12).fill(0), realCon: Array(12).fill(null) };
      l.meses[p.mes - 1] = Number(p.monto); l.realCon[p.mes - 1] = p.real_conciliado == null ? null : Number(p.real_conciliado); m.set(p.linea, l);
    });
    return [...m.values()].sort((a, b) => (a.categoria ?? "").localeCompare(b.categoria ?? "", "es") || a.linea.localeCompare(b.linea, "es"));
  }, [plan]);
  const [movs, setMovs] = useState(initial.movs);
  const mesDe = (f: string) => Number(f.slice(5, 7));
  const movsDe = (l: Linea, mes: number) => movs.filter((m) => m.estado === "real" && mesDe(m.fecha) === mes && l.rubro_id && m.rubro_id === l.rubro_id);
  const realDe = (l: Linea, mes: number) => concil ? (l.realCon[mes - 1] ?? 0) : sum(movsDe(l, mes).map((m) => m.monto_mxn));
  const realLinea = (l: Linea) => Array.from({ length: 12 }, (_, i) => realDe(l, i + 1));
  const planAnual = (l: Linea) => sum(l.meses);
  const planFecha = (l: Linea) => l.anual ? (planAnual(l) * mesActual) / 12 : sum(l.meses.slice(0, mesActual));
  const planMes = (l: Linea, i: number) => l.anual ? planAnual(l) / 12 : l.meses[i];
  const [abierta, setAbierta] = useState<string | null>(null);   // línea con la cuadrícula mensual abierta
  const [vista, setVista] = useState<"cuadricula" | "plan">("cuadricula");
  const [nuevaEn, setNuevaEn] = useState<string | null>(null);   // rubro donde se está agregando una línea
  const [gVer, setGVer] = useState<"real" | "plan">("real");       // visión general: real o presupuesto
  const [gMes, setGMes] = useState<number>(0);                      // 0 = año completo, -1 = a la fecha, n = mes
  const [gSel, setGSel] = useState("");                             // rubro seleccionado en la dona
  const categorias = useMemo(() => [...new Set(lineas.map((l) => l.categoria ?? "Sin rubro"))].sort((a, b) => a.localeCompare(b, "es")), [lineas]);
  const padres = useMemo(() => initial.rubros.filter((r) => !r.padre_id).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [initial.rubros]);
  const hijosDe = (padreNombre: string | null) => { const p = initial.rubros.find((r) => !r.padre_id && r.nombre === padreNombre); return p ? initial.rubros.filter((r) => r.padre_id === p.id).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")) : []; };
  const nombreRubro = (id: string | null) => initial.rubros.find((r) => r.id === id)?.nombre ?? null;
  const mios = lineas.filter((l) => l.pagador === "CABZ"), ellos = lineas.filter((l) => l.pagador !== "CABZ" && l.pagador !== "HAMB");
  const planTotal = sum(mios.map(planAnual));                       // presupuesto = lo que sale de mí (gastos + depósitos)
  const planAFecha = sum(mios.map(planFecha));
  const realTotal = sum(mios.flatMap(realLinea));
  const planEllos = sum(ellos.map(planAnual));
  const realSinLinea = useMemo(() => { if (concil) return []; const m = new Map<string, number>(); movs.forEach((r) => { if (r.estado !== "real" || !r.monto_mxn) return; if (lineas.some((l) => l.rubro_id && r.rubro_id === l.rubro_id)) return; const k = nombreRubro(r.rubro_id) ?? "Sin subrubro"; m.set(k, (m.get(k) ?? 0) + r.monto_mxn); }); return [...m].map(([linea, real]) => ({ linea, real })); }, [movs, lineas, concil]);

  /* ---------- aportaciones: quién puso el dinero ---------- */
  const gastosAkela = initial.libro.filter((x) => x.concepto === "gasto");
  const aportes = initial.libro.filter((x) => x.concepto === "aportacion");
  const retiros = initial.libro.filter((x) => x.concepto === "retiro");
  const porMes = Array.from({ length: 12 }, (_, i) => {
    const k = `${anio}-${String(i + 1).padStart(2, "0")}`;
    const g = gastosAkela.filter((x) => x.mes.startsWith(k)), a = aportes.filter((x) => x.mes.startsWith(k));
    const yo = sum(g.filter((x) => x.quien === "CABZ").map((x) => x.salida_mxn)) + sum(a.filter((x) => (x.quien ?? "CABZ") === "CABZ").map((x) => x.entrada_mxn));
    const lm = sum(a.filter((x) => x.quien === "HAMB").map((x) => x.entrada_mxn)) + sum(g.filter((x) => x.quien === "HAMB").map((x) => x.salida_mxn));
    const papas = sum(g.filter((x) => x.quien === "CABU" || x.quien === "MPZB").map((x) => x.salida_mxn));
    const r = retiros.filter((x) => x.mes.startsWith(k));
    const retYo = sum(r.filter((x) => (x.quien ?? "CABZ") === "CABZ").map((x) => x.salida_mxn)), retLM = sum(r.filter((x) => x.quien === "HAMB").map((x) => x.salida_mxn));
    return { k, yo, lm, papas, retYo, retLM, netoYo: yo - retYo, netoLM: lm - retLM };
  });
  const totYo = sum(porMes.map((m) => m.yo)), totLM = sum(porMes.map((m) => m.lm));
  const totRetYo = sum(porMes.map((m) => m.retYo)), totRetLM = sum(porMes.map((m) => m.retLM));
  const netoYo = totYo - totRetYo, netoLM = totLM - totRetLM;

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
  const setAttr = async (l: typeof lineas[number], campo: "categoria" | "rubro_id" | "pagador" | "es_transferencia" | "anual", valor: string | boolean | null) => {
    let patch: Record<string, unknown> = { [campo]: valor === "" ? null : valor };
    if (campo === "pagador") { const { data: pg } = await supabase.from("pagadores").select("id").eq("codigo", valor).maybeSingle(); if (!pg) return aviso("Pagador no encontrado."); patch = { pagador_id: pg.id }; }
    if (campo === "categoria") patch.rubro_id = null;
    const { error } = await supabase.from("plan_akela").update(patch).eq("anio", anio).eq("linea", l.linea);
    if (error) return aviso("No se guardó: " + error.message + (/categoria|anual/.test(error.message) ? " (corre 36_akela_definitivo.sql)" : ""));
    setPlan((prev) => prev.map((p) => p.linea !== l.linea ? p : campo === "pagador" ? { ...p, pagador: String(valor) } : campo === "es_transferencia" ? { ...p, es_transferencia: !!valor } : campo === "anual" ? { ...p, anual: !!valor } : campo === "rubro_id" ? { ...p, rubro_id: valor === "" ? null : String(valor), subrubro: nombreRubro(valor === "" ? null : String(valor)) } : { ...p, categoria: valor === "" ? null : String(valor), rubro_id: null, subrubro: null }));
  };
  const setAnualMonto = async (l: Linea, total: number) => { setBusy(true); await setCelda(l, 1, total); for (let m = 2; m <= 12; m++) if (l.meses[m - 1]) await setCelda(l, m, 0); setBusy(false); aviso(`${l.linea}: ${fmt(total)} anual.`); };
  /* real: 2026 → columna real_conciliado; 2027+ → movimiento de gasto en Gastos (libro Akela) por la diferencia */
  const setRealCon = async (l: Linea, mes: number, nuevo: number) => {
    const { error } = await supabase.from("plan_akela").update({ real_conciliado: nuevo || null }).eq("anio", anio).eq("linea", l.linea).eq("mes", mes);
    if (error) return aviso("No se guardó: " + error.message + (/real_conciliado/.test(error.message) ? " (corre 36_akela_definitivo.sql)" : ""));
    setPlan((prev) => prev.map((p) => p.linea === l.linea && p.mes === mes ? { ...p, real_conciliado: nuevo || null } : p));
  };
  /* gasto real (2027+): igual que en Gastos — fecha, descripción, cuenta, MSI; va al libro Akela con el subrubro del concepto */
  const [celda, setCelda2] = useState<{ linea: string; mes: number } | null>(null);
  const registrarGasto = async (l: Linea, g: { fecha: string; descripcion: string; monto: number; cuenta_id: string; msi: number; nota: string }) => {
    if (!l.rubro_id) return aviso("Liga el concepto a un subrubro (Editar plan) para registrar el gasto.");
    setBusy(true);
    try {
      const [y, m0, dia] = [+g.fecha.slice(0, 4), +g.fecha.slice(5, 7), +g.fecha.slice(8, 10)];
      const fechaMes = (i: number) => { const d = new Date(Date.UTC(y, m0 - 1 + i, 1)); const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(dia, ult)).padStart(2, "0")}`; };
      const n = g.msi > 0 ? g.msi : 1; const cuota = g.msi > 0 ? Math.round((g.monto / g.msi) * 100) / 100 : g.monto;
      const nuevos: typeof movs = [];
      for (let i = 0; i < n; i++) {
        const monto = g.msi > 0 && i === n - 1 ? Math.round((g.monto - cuota * (n - 1)) * 100) / 100 : cuota;
        const notaMsi = g.msi > 0 ? `MSI ${i + 1}/${g.msi} · total ${fmt(g.monto)}` : "";
        const p = { fecha: fechaMes(i), tipo: "gasto", estado: "real", descripcion: g.descripcion || l.linea, monto, cuenta_id: g.cuenta_id, rubro_id: l.rubro_id, notas: [g.nota, notaMsi].filter(Boolean).join(" · ") || null, asignaciones: [{ libro: "AKELA", pagador: "CABZ", porcentaje: 100 }] };
        const { data, error } = await supabase.rpc("registrar_movimiento", { p }); if (error) throw error;
        nuevos.push({ id: data as string, fecha: p.fecha, descripcion: p.descripcion, monto_mxn: monto, rubro_id: l.rubro_id, notas: p.notas, estado: "real", cuenta: initial.medios.find((c) => c.id === g.cuenta_id)?.nombre ?? null, pagador: "CABZ" });
      }
      setMovs((prev) => [...prev, ...nuevos].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      aviso(`${l.linea}: ${fmt(g.monto)} registrado en Gastos${g.msi > 0 ? ` · ${g.msi} MSI de ${fmt(cuota)}` : ""}.`);
    } catch (e) { aviso("No se registró: " + (e as Error).message); }
    setBusy(false);
  };
  const [depLM, setDepLM] = useState(initial.depLM);
  const [abrirDep, setAbrirDep] = useState(false);
  const fondoNombres = initial.fondo.map((f) => f.nombre);
  const depLMFuera = (mes: number) => depLM.filter((d) => Number(d.fecha.slice(5, 7)) === mes && !fondoNombres.includes(d.cuenta_destino ?? "")).reduce((a, d) => a + d.monto_mxn, 0);
  const registrarDepLM = async (g: { fecha: string; monto: number; destino_id: string; nota: string }) => {
    const dest = initial.destinos.find((c) => c.id === g.destino_id); if (!dest) return aviso("Elige a dónde va.");
    setBusy(true);
    const { data, error } = await supabase.rpc("registrar_movimiento", { p: { fecha: g.fecha, tipo: "transferencia", cuenta: "Aportaciones Luis Miguel", cuenta_destino_id: g.destino_id, monto: g.monto, moneda: "MXN", contraparte: "HAMB", descripcion: g.nota || `Depósito de Luis Miguel → ${dest.nombre}` } });
    setBusy(false);
    if (error) return aviso("No se registró: " + error.message + (/Cuenta no encontrada/.test(error.message) ? " (falta la cuenta «Aportaciones Luis Miguel»)" : ""));
    setDepLM((prev) => [...prev, { id: data as string, fecha: g.fecha, monto_mxn: g.monto, cuenta: "Aportaciones Luis Miguel", cuenta_destino: dest.nombre, descripcion: g.nota || null }]);
    aviso(`Depósito de Luis Miguel ${fmt(g.monto)} → ${dest.nombre}${dest.tipo === "fondo" ? " (cuenta como aportación al fondo)" : ""}.`);
    if (dest.tipo === "fondo") setTimeout(() => window.location.reload(), 1200);
  };
  const borrarDepLM = async (id: string) => { if (!confirm("¿Borrar este depósito?")) return; const { error } = await supabase.from("movimientos").delete().eq("id", id); if (error) return aviso(error.message); setDepLM((p) => p.filter((d) => d.id !== id)); };
  const borrarGasto = async (id: string) => {
    if (!confirm("¿Borrar este gasto? Se quita también de Gastos.")) return;
    const { error } = await supabase.from("movimientos").delete().eq("id", id);
    if (error) return aviso(error.message); setMovs((prev) => prev.filter((m) => m.id !== id));
  };
  const crearSubrubro = async (padreNombre: string, nombre: string) => {
    const padre = initial.rubros.find((r) => !r.padre_id && r.nombre === padreNombre); if (!padre) return null;
    const slug = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const { data, error } = await supabase.from("rubros").insert({ codigo: `${padre.codigo}__${slug}`, nombre, naturaleza: "gasto", padre_id: padre.id }).select("id").single();
    if (error) { aviso("No se creó el subrubro: " + error.message); return null; }
    return data.id as string;
  };
  const borrarLinea = async (l: typeof lineas[number]) => {
    if (!confirm(`¿Quitar "${l.linea}" del plan ${anio}?`)) return;
    const { error } = await supabase.from("plan_akela").delete().eq("anio", anio).eq("linea", l.linea);
    if (error) return aviso(error.message); setPlan((p) => p.filter((x) => x.linea !== l.linea));
  };
  const proponer = async (modo: "anual" | "ult3") => {
    if (!confirm(`Llenar el plan ${anio} con ${modo === "ult3" ? "el promedio de los últimos 3 meses" : "el promedio anual"} de ${anio - 1} (solo celdas vacías)?`)) return;
    const { data, error } = await supabase.rpc("proponer_plan_akela", { p_de: anio - 1, p_a: anio, p_meses: modo === "ult3" ? 3 : null });
    if (error) return aviso(error.message + (/function/i.test(error.message) ? " (corre 32_plan_akela_2026.sql)" : "")); aviso(`${data} celdas propuestas.`); window.location.reload();
  };
  const guardarParams = async () => {
    const { error } = await supabase.from("app_config").update({ akela_nac_papa: pr.nac_papa, akela_nac_mama: pr.nac_mama, akela_rend_real: pr.rend_real, akela_tc: pr.tc }).not("owner_id", "is", null);
    aviso(error ? "No se guardó: " + error.message : "Parámetros guardados.");
  };

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + " %" : "—");
  const Barra = ({ plan, real, pf, w, h }: { plan: number; real: number; pf: number; w: number; h: number }) => (
    <div style={{ position: "relative", height: h, border: "1px solid var(--ink)", borderRadius: h / 2, background: "var(--cream)", overflow: "hidden" }} title={`plan ${fmt(plan)} · a la fecha ${fmt(pf)} · real ${fmt(real)} (${pct(real, pf)})`}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (plan / w) * 100)}%`, background: "var(--gray-soft)", opacity: .35 }} />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (real / w) * 100)}%`, background: real > pf && pf ? "var(--neg)" : "var(--akela)" }} />
      {pf > 0 && <div style={{ position: "absolute", left: `${Math.min(100, (pf / w) * 100)}%`, top: 0, bottom: 0, borderLeft: "2px dashed var(--ink)" }} />}
    </div>);
  /* detalle y alta de gastos de un concepto en un mes (2027+) */
  const PanelGasto = ({ l, mes }: { l: Linea; mes: number }) => {
    const lista = movsDe(l, mes);
    const hoy = new Date(); const def = hoy.getFullYear() === anio && hoy.getMonth() + 1 === mes ? hoy.toISOString().slice(0, 10) : `${anio}-${String(mes).padStart(2, "0")}-01`;
    const [g, setG] = useState({ fecha: def, descripcion: "", monto: "", cuenta_id: initial.medios.find((c) => /cheques/i.test(c.nombre))?.id ?? initial.medios[0]?.id ?? "", msi: 0, nota: "" });
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><b>{l.linea} · {MESN[mes - 1]} {anio}</b><span className="hint">plan {fmt(planMes(l, mes - 1))} · real {fmt(sum(lista.map((m) => m.monto_mxn)))}</span></div>
        {lista.length > 0 && <div className="tbl" style={{ marginBottom: 6 }}><table style={{ fontSize: 12 }}><tbody>
          {lista.map((m) => <tr key={m.id}><td>{m.fecha}</td><td style={{ whiteSpace: "normal" }}>{m.descripcion}{m.notas ? <span className="hint"> · {m.notas}</span> : null}</td><td className="hint">{m.cuenta}</td><td className="n" style={{ fontWeight: 600 }}>{fmt2(m.monto_mxn)}</td><td><button className="del" type="button" onClick={() => borrarGasto(m.id)}>✕</button></td></tr>)}
        </tbody></table></div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div><label style={{ margin: "0 0 2px" }}>Fecha</label><input type="date" value={g.fecha} onChange={(e) => setG({ ...g, fecha: e.target.value })} /></div>
          <div><label style={{ margin: "0 0 2px" }}>Concepto del gasto <span className="h">(p. ej. llantas)</span></label><input type="text" value={g.descripcion} onChange={(e) => setG({ ...g, descripcion: e.target.value })} placeholder={l.linea} style={{ width: 200 }} /></div>
          <div><label style={{ margin: "0 0 2px" }}>Monto</label><input type="number" value={g.monto} onChange={(e) => setG({ ...g, monto: e.target.value })} style={{ width: 110 }} /></div>
          <div><label style={{ margin: "0 0 2px" }}>Cuenta</label><select value={g.cuenta_id} onChange={(e) => setG({ ...g, cuenta_id: e.target.value })}>{initial.medios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
          <div><label style={{ margin: "0 0 2px" }}>Meses sin intereses</label><select value={g.msi} onChange={(e) => setG({ ...g, msi: Number(e.target.value) })}><option value={0}>no</option>{[3, 6, 9, 12, 18, 24].map((n) => <option key={n} value={n}>{n} MSI</option>)}</select></div>
          <div><label style={{ margin: "0 0 2px" }}>Nota</label><input type="text" value={g.nota} onChange={(e) => setG({ ...g, nota: e.target.value })} style={{ width: 160 }} /></div>
          <button className="btn sm" type="button" disabled={busy || !(Number(g.monto) > 0)} onClick={() => registrarGasto(l, { ...g, monto: Number(g.monto) })}>Registrar gasto</button>
          <button className="btn ghost sm" type="button" onClick={() => setCelda2(null)}>Cerrar</button>
        </div>
        {g.msi > 0 && Number(g.monto) > 0 && <p className="hint" style={{ margin: "4px 0 0" }}>{g.msi} cuotas de {fmt(Number(g.monto) / g.msi)} desde {g.fecha}: cada una cae en su mes.</p>}
      </div>);
  };
  /* depósito de Luis Miguel: pregunta a dónde va (fondo o una cuenta mía) */
  const DepositoLM = () => {
    const [g, setG] = useState({ fecha: new Date().toISOString().slice(0, 10), monto: "", destino_id: initial.destinos.find((c) => c.tipo === "fondo")?.id ?? "", nota: "" });
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "4px 0" }}>
        <div><label style={{ margin: "0 0 2px" }}>Fecha</label><input type="date" value={g.fecha} onChange={(e) => setG({ ...g, fecha: e.target.value })} /></div>
        <div><label style={{ margin: "0 0 2px" }}>Monto</label><input type="number" value={g.monto} onChange={(e) => setG({ ...g, monto: e.target.value })} style={{ width: 110 }} /></div>
        <div><label style={{ margin: "0 0 2px" }}>¿A dónde va?</label><select value={g.destino_id} onChange={(e) => setG({ ...g, destino_id: e.target.value })}>{initial.destinos.map((c) => <option key={c.id} value={c.id}>{c.tipo === "fondo" ? `${c.nombre} (fondo)` : `${c.nombre} (a mí)`}</option>)}</select></div>
        <div><label style={{ margin: "0 0 2px" }}>Nota</label><input type="text" value={g.nota} onChange={(e) => setG({ ...g, nota: e.target.value })} style={{ width: 200 }} /></div>
        <button className="btn sm" type="button" disabled={busy || !(Number(g.monto) > 0)} onClick={() => registrarDepLM({ ...g, monto: Number(g.monto) })}>Registrar</button>
      </div>);
  };
  /* alta de concepto dentro de un rubro: subrubro existente o nuevo, quién paga, mensual o anual */
  const NuevaLinea = ({ padre }: { padre: string | null }) => {
    const [f, setF] = useState({ padre: padre ?? "", concepto: "", rubro_id: "", nuevoSub: "", pagador: "CABZ", modo: "mensual" as "mensual" | "anual", monto: "", transferencia: false });
    const hijos = hijosDe(f.padre || null);
    const guardar = async () => {
      const monto = Number(f.monto); const nombre = f.concepto.trim() || (f.rubro_id === "__nuevo__" ? f.nuevoSub.trim() : hijos.find((h) => h.id === f.rubro_id)?.nombre ?? "");
      if (!f.padre) return aviso("Elige el rubro."); if (!nombre) return aviso("Escribe el concepto."); if (!(monto >= 0)) return aviso("Monto.");
      if (lineas.some((l) => l.linea === nombre)) return aviso(`Ya existe el concepto «${nombre}» en ${anio}.`);
      setBusy(true);
      let rubro: string | null = f.rubro_id && f.rubro_id !== "__nuevo__" ? f.rubro_id : null;
      if (f.rubro_id === "__nuevo__" && f.nuevoSub.trim()) rubro = await crearSubrubro(f.padre, f.nuevoSub.trim());
      for (let m = 1; m <= 12; m++) { const v = f.modo === "anual" ? (m === 1 ? monto : 0) : monto; const { error } = await supabase.rpc("plan_akela_set", { p_anio: anio, p_linea: nombre, p_mes: m, p_monto: v, p_pagador: f.pagador, p_transferencia: f.transferencia, p_rubro: rubro }); if (error) { setBusy(false); return aviso("No se agregó: " + error.message); } }
      await supabase.from("plan_akela").update({ categoria: f.padre, anual: f.modo === "anual" }).eq("anio", anio).eq("linea", nombre);
      setBusy(false); window.location.reload();
    };
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: "4px 0" }}>
        {!padre && <div><label style={{ margin: "0 0 2px" }}>Rubro</label><select value={f.padre} onChange={(e) => setF({ ...f, padre: e.target.value, rubro_id: "" })}><option value="">—</option>{padres.map((r) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}</select></div>}
        <div><label style={{ margin: "0 0 2px" }}>Subrubro</label><select value={f.rubro_id} onChange={(e) => setF({ ...f, rubro_id: e.target.value })}><option value="">— sin ligar —</option>{hijos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}<option value="__nuevo__">＋ crear nuevo…</option></select></div>
        {f.rubro_id === "__nuevo__" && <div><label style={{ margin: "0 0 2px" }}>Nuevo subrubro</label><input type="text" value={f.nuevoSub} onChange={(e) => setF({ ...f, nuevoSub: e.target.value })} placeholder="p. ej. Estudios de sangre" /></div>}
        <div><label style={{ margin: "0 0 2px" }}>Concepto <span className="h">(vacío = nombre del subrubro)</span></label><input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} style={{ width: 180 }} /></div>
        <div><label style={{ margin: "0 0 2px" }}>Quién paga</label><select value={f.pagador} onChange={(e) => setF({ ...f, pagador: e.target.value })}>{initial.pagadores.filter((p) => p.codigo !== "HAMB").map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre}</option>)}</select></div>
        <div><label style={{ margin: "0 0 2px" }}>Presupuesto</label><div style={{ display: "flex", gap: 4 }}><select value={f.modo} onChange={(e) => setF({ ...f, modo: e.target.value as "mensual" | "anual" })}><option value="mensual">mensual</option><option value="anual">anual</option></select><input type="number" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} style={{ width: 100 }} /></div></div>
        <label style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center", margin: "0 0 8px" }}><input type="checkbox" checked={f.transferencia} onChange={(e) => setF({ ...f, transferencia: e.target.checked })} /> transferencia</label>
        <button className="btn sm" type="button" onClick={guardar} disabled={busy}>Agregar</button>
      </div>);
  };
  const inp = { padding: "3px 5px", fontSize: 12, width: 86, textAlign: "right" as const };

  return (
    <section>
      <div className="idea"><b>Akela</b> El patrimonio y los gastos de tus papás en un solo lugar: el presupuesto del año línea por línea (quién lo paga), cómo va contra lo real, cuánto has puesto tú y cuánto Luis Miguel, el saldo del fondo y hasta qué edad alcanza. {ro && "Vista de solo lectura."}</div>

      <div className={"card" + (busy ? " spin" : "")}>
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
          <div className="lbl" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span><b>Quién ha puesto el dinero en {anio}</b></span><span>yo {fmt(totYo)}{totRetYo ? ` (neto ${fmt(netoYo)} tras retirar ${fmt(totRetYo)} del fondo)` : ""} · Luis Miguel {fmt(totLM)}{totRetLM ? ` (neto ${fmt(netoLM)})` : ""} · ellos {fmt(sum(porMes.map((m) => m.papas)))}</span></div>
          {(() => { const t = totYo + totLM + sum(porMes.map((m) => m.papas)) || 1; const py = (totYo / t) * 100, pl = (totLM / t) * 100, pp = 100 - py - pl; return (
            <div style={{ display: "flex", height: 22, border: "1.5px solid var(--ink)", borderRadius: 11, overflow: "hidden", fontSize: 11, fontWeight: 700, color: "#fff" }}>
              <div style={{ width: `${py}%`, background: "var(--c6)", display: "flex", alignItems: "center", paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }} title={`Yo: ${fmt(totYo)}`}>{py > 12 ? `yo ${Math.round(py)} %` : ""}</div>
              <div style={{ width: `${pl}%`, background: "var(--nec)", display: "flex", alignItems: "center", paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }} title={`Luis Miguel: ${fmt(totLM)}`}>{pl > 12 ? `Luis Miguel ${Math.round(pl)} %` : ""}</div>
              <div style={{ width: `${pp}%`, background: "var(--akela)", display: "flex", alignItems: "center", paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }} title="Pagado por papás con lo transferido">{pp > 12 ? `ellos ${Math.round(pp)} %` : ""}</div>
            </div>); })()}
        </div>
      </div>

      <h2>1 · Visión general {anio}</h2>
      {(() => {
        const mesesSel = gMes === 0 ? Array.from({ length: 12 }, (_, i) => i) : gMes === -1 ? Array.from({ length: mesActual }, (_, i) => i) : [gMes - 1];
        const valor = (l: Linea, i: number) => gVer === "real" ? realLinea(l)[i] : planMes(l, i);
        const otro = (l: Linea, i: number) => gVer === "real" ? planMes(l, i) : realLinea(l)[i];
        const catOf = (l: Linea) => l.categoria ?? "Sin rubro";
        const porCat = new Map<string, number>(); const porCatOtro = new Map<string, number>();
        mios.forEach((l) => { const v = sum(mesesSel.map((i) => valor(l, i))), o = sum(mesesSel.map((i) => otro(l, i))); porCat.set(catOf(l), (porCat.get(catOf(l)) ?? 0) + v); porCatOtro.set(catOf(l), (porCatOtro.get(catOf(l)) ?? 0) + o); });
        const cats = [...porCat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) as [string, number][];
        const tot = sum(cats.map((x) => x[1])), mx = cats[0]?.[1] || 1;
        const subs = gSel ? mios.filter((l) => catOf(l) === gSel).map((l) => ({ linea: l.linea, v: sum(mesesSel.map((i) => valor(l, i))), o: sum(mesesSel.map((i) => otro(l, i))) })).filter((x) => x.v || x.o).sort((a, b) => b.v - a.v) : [];
        const subTot = sum(subs.map((x) => x.v));
        const mesesK = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);
        const matriz: Record<string, Record<string, number>> = {}; const matrizOtro: Record<string, Record<string, number>> = {};
        mesesK.forEach((k, i) => { matriz[k] = {}; matrizOtro[k] = {}; mios.forEach((l) => { const c = catOf(l); matriz[k][c] = (matriz[k][c] ?? 0) + valor(l, i); matrizOtro[k][c] = (matrizOtro[k][c] ?? 0) + otro(l, i); }); });
        const rubrosT = [...new Set(mios.map(catOf))].sort((a, b) => sum(mesesK.map((k) => matriz[k][b] ?? 0)) - sum(mesesK.map((k) => matriz[k][a] ?? 0)));
        const planSel = sum(mios.flatMap((l) => mesesSel.map((i) => planMes(l, i)))), realSel = sum(mios.flatMap((l) => mesesSel.map((i) => realLinea(l)[i])));
        const etiqueta = gVer === "real" ? "Gastado" : "Presupuesto";
        return (
          <>
            <div className="card">
              <div className="g4" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                <div><label htmlFor="g-anio">Año</label><select id="g-anio" value={anio} onChange={(e) => router.push(`/akela?anio=${e.target.value}`)}>{initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
                <div><label htmlFor="g-ver">Ver</label><select id="g-ver" value={gVer} onChange={(e) => setGVer(e.target.value as "real" | "plan")}><option value="real">Gastos reales</option><option value="plan">Presupuesto</option></select></div>
                <div><label htmlFor="g-mes">Periodo</label><select id="g-mes" value={gMes} onChange={(e) => setGMes(Number(e.target.value))}><option value={0}>Año completo</option>{mesActual > 0 && <option value={-1}>A la fecha (ene–{MESN[mesActual - 1]})</option>}{MESN.map((m, i) => <option key={m} value={i + 1}>{m} {String(anio).slice(2)}</option>)}</select></div>
                <div><label>Quién</label><div className="hint" style={{ paddingTop: 8 }}>Pago yo (gastos + depósitos). Papá y mamá: informativo en la cuadrícula.</div></div>
              </div>
              <div className="stat-row" style={{ marginBottom: 0 }}>
                <div className="stat"><div className="v">{fmt(realSel)}</div><div className="l">Gastado{gMes === 0 ? " en el año" : gMes === -1 ? " a la fecha" : ` en ${MESN[gMes - 1]}`}</div></div>
                <div className="stat"><div className="v">{fmt(planSel)}</div><div className="l">Presupuesto del periodo</div></div>
                <div className="stat"><div className={"v " + (realSel > planSel ? "neg" : "pos")}>{pct(realSel, planSel)}</div><div className="l">del presupuesto · {realSel > planSel ? "+" : ""}{fmt(realSel - planSel)}</div></div>
                <div className="stat"><div className="v">{fmt(fondoMxn)}</div><div className="l">Fondo Akela · {planTotal ? (fondoMxn / planTotal).toFixed(1) : "—"} años de presupuesto</div></div>
              </div>
            </div>
            <div className="card">
              <div className="ct"><span>Por rubro · {etiqueta.toLowerCase()}</span><span className="tag">{gSel ? "viendo " + gSel : "toca un rubro para ver sus conceptos"}</span></div>
              <div className="dona-wrap">
                <Dona cats={cats} tot={tot} sel={gSel} />
                <div style={{ flex: 1, minWidth: 260 }}>
                  {cats.length === 0 && <p className="hint">Sin {etiqueta.toLowerCase()} en este periodo.</p>}
                  {cats.map(([c, v]) => { const o = porCatOtro.get(c) ?? 0; return (
                    <div key={c} className={"catbar" + (c === gSel ? " on" : "")} role="button" tabIndex={0} onClick={() => setGSel(gSel === c ? "" : c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setGSel(gSel === c ? "" : c); } }}>
                      <div className="lbl"><span><i style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: color(c), border: "1.5px solid var(--ink)", verticalAlign: -1, marginRight: 6 }} />{c}</span><span>{fmt(v)} · {tot ? Math.round((v / tot) * 100) : 0}%{o ? <span className="hint"> · {gVer === "real" ? "ppto" : "real"} {fmt(o)}</span> : null}</span></div>
                      <div className="track"><div className="fill" style={{ width: `${(v / mx) * 100}%`, background: color(c) }} />{o > 0 && <div className="mark" style={{ left: `${Math.min(100, (o / mx) * 100)}%` }} title={`${gVer === "real" ? "presupuesto" : "real"} ${fmt(o)}`} />}</div>
                    </div>); })}
                </div>
              </div>
            </div>
            {gSel && (
              <div className="card">
                <div className="ct"><span>{gSel} · {fmt(subTot)} por concepto</span><button className="btn ghost sm" type="button" onClick={() => setGSel("")}>Ver todos</button></div>
                {subs.map((x) => (
                  <div key={x.linea} className="catbar">
                    <div className="lbl"><span>{x.linea}</span><span>{fmt(x.v)} · {subTot ? Math.round((x.v / subTot) * 100) : 0}%{x.o ? <span className="hint"> · {gVer === "real" ? "ppto" : "real"} {fmt(x.o)}</span> : null}</span></div>
                    <div className="track"><div className="fill" style={{ width: `${(x.v / (subs[0]?.v || 1)) * 100}%`, background: color(gSel) }} />{x.o > 0 && <div className="mark" style={{ left: `${Math.min(100, (x.o / (subs[0]?.v || 1)) * 100)}%` }} />}</div>
                  </div>))}
              </div>)}
            <div className="card">
              <div className="ct"><span>Por mes · {etiqueta.toLowerCase()}</span><span className="tag">barras por rubro · la tabla muestra {gVer === "real" ? "real" : "presupuesto"} y debajo {gVer === "real" ? "presupuesto" : "real"}</span></div>
              <BarrasMes meses={mesesK} rubros={rubrosT} data={matriz} />
              <div className="tbl" style={{ marginTop: 12 }}><table style={{ fontSize: 12 }}>
                <thead><tr><th>Rubro</th>{mesesK.map((k) => <th className="n" key={k}>{ml(k)}</th>)}<th className="n">Total</th><th className="n">/mes</th></tr></thead>
                <tbody>
                  {rubrosT.map((rb) => { const vals = mesesK.map((k) => matriz[k]?.[rb] ?? 0), t = sum(vals); const ov = mesesK.map((k) => matrizOtro[k]?.[rb] ?? 0), ot = sum(ov); return (
                    <Fragment key={rb}>
                      <tr className="lead" style={{ cursor: "pointer" }} onClick={() => setGSel(gSel === rb ? "" : rb)}><td><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: color(rb), border: "1.5px solid var(--ink)", marginRight: 6, verticalAlign: -1 }} />{rb}</td>{vals.map((v, i) => <td key={i} className={"n" + (gVer === "real" && ov[i] && v > ov[i] ? " neg" : "")}>{v ? fmt(v) : "·"}</td>)}<td className="n" style={{ fontWeight: 700 }}>{fmt(t)}</td><td className="n">{fmt(t / 12)}</td></tr>
                      <tr className="sub"><td className="hint" style={{ paddingLeft: 22 }}>{gVer === "real" ? "presupuesto" : "real"}</td>{ov.map((v, i) => <td key={i} className="n" style={{ color: "var(--gray-soft)" }}>{v ? fmt(v) : "·"}</td>)}<td className="n" style={{ color: "var(--gray-soft)" }}>{fmt(ot)}</td><td className="n" style={{ color: "var(--gray-soft)" }}>{fmt(ot / 12)}</td></tr>
                    </Fragment>); })}
                  <tr className="tot"><td>Total</td>{mesesK.map((k) => <td key={k} className="n">{fmt(sum(Object.values(matriz[k] ?? {})))}</td>)}<td className="n">{fmt(sum(mesesK.map((k) => sum(Object.values(matriz[k] ?? {})))))}</td><td className="n">{fmt(sum(mesesK.map((k) => sum(Object.values(matriz[k] ?? {})))) / 12)}</td></tr>
                </tbody>
              </table></div>
            </div>
          </>); })()}

      <h2>2 · Presupuesto {anio} · por rubro y concepto</h2>
      <div className="card full-bleed">
        <div className="stat-row">
          <div className="stat"><div className="v">{fmt(planTotal)}</div><div className="l">Pago yo (gastos + depósitos) · real {fmt(realTotal)} / a la fecha {fmt(planAFecha)}</div></div>
          {(["CABU", "MPZB"] as const).map((q) => { const ls = ellos.filter((l) => l.pagador === q); const dep = mios.filter((l) => (q === "CABU" ? /pap[aá]/i : /mam[aá]/i).test(l.subrubro ?? l.linea)); return (
            <div key={q} className="stat"><div className="v">{fmt(sum(dep.map(planAnual)))}</div><div className="l">Depósito a {q === "CABU" ? "papá" : "mamá"} · {q === "CABU" ? "él" : "ella"} cubre {fmt(sum(ls.map(planAnual)))} (informativo)</div></div>); })}
          <div className="stat"><div className="v">{fmt(totLM)}</div><div className="l">Luis Miguel → directo al fondo{totRetLM ? ` · neto ${fmt(netoLM)}` : ""}</div></div>
        </div>
        <div className="ct"><span>Plan vs real</span>
          <span className="pills" style={{ margin: 0 }}><button type="button" className="pill" aria-pressed={vista === "cuadricula"} onClick={() => setVista("cuadricula")}>Cuadrícula</button><a className="pill" href={`/api/akela/xlsx?anio=${anio}`} title="Plan, real y gastos del año en Excel" style={{ marginLeft: 6 }}>⬇ Excel</a>{!ro && <button type="button" className="pill" aria-pressed={vista === "plan"} onClick={() => setVista("plan")}>Editar plan</button>}</span>
          {!ro && vista === "plan" && <span style={{ display: "flex", gap: 6 }}><button className="btn ghost sm" type="button" onClick={() => proponer("anual")} title={`Promedio de los 12 meses de ${anio - 1}`}>Proponer: promedio {anio - 1}</button><button className="btn ghost sm" type="button" onClick={() => proponer("ult3")} title={`Promedio de los últimos 3 meses con datos de ${anio - 1}`}>Proponer: últimos 3 meses</button></span>}</div>

        {vista === "cuadricula" && (
          <TablaFija grupo="akela-grid" alto="72vh"><table className="akela-grid" style={{ fontSize: 11.5 }}>
            <thead><tr><th>Concepto</th><th>Subrubro</th><th>Quién</th>{MESN.map((m, i) => <th key={m} className="n" style={i + 1 === mesActual ? { textDecoration: "underline" } : undefined}>{m}</th>)}<th className="n">Año</th><th style={{ width: 90 }}>Avance</th></tr></thead>
            <tbody>
              {categorias.map((c) => { const ls = lineas.filter((l) => (l.categoria ?? "Sin rubro") === c && l.pagador !== "HAMB"); const mi = ls.filter((l) => l.pagador === "CABZ"); const tp = sum(mi.map(planAnual)), tr = sum(mi.flatMap(realLinea)), tpf = sum(mi.map(planFecha)); return (
                <Fragment key={c}>
                  <tr className="sec"><td colSpan={3}><b>{c}</b>{!ro && <> <button className="link" type="button" style={{ fontSize: 11, marginLeft: 8 }} onClick={() => setNuevaEn(nuevaEn === c ? null : c)}>{nuevaEn === c ? "cancelar" : "+ concepto"}</button></>}</td>
                    {Array.from({ length: 12 }, (_, i) => <td key={i} className="n" style={{ color: "var(--gray-soft)" }}>{(() => { const v = sum(mi.map((l) => planMes(l, i))); return v ? fmt(v) : ""; })()}</td>)}
                    <td className="n"><b>{fmt(tp)}</b>{tr ? <span className="hint" style={{ fontSize: 10.5 }}> · real {fmt(tr)}</span> : null}</td><td>{tp ? <Barra plan={tp} real={tr} pf={tpf} w={tp} h={10} /> : null}</td></tr>
                  {nuevaEn === c && !ro && <tr><td colSpan={17} style={{ background: "var(--bone)" }}><NuevaLinea padre={c} /></td></tr>}
                  {ls.map((l) => { const re = realLinea(l); const tp = planAnual(l), tr = sum(re), tpf = planFecha(l); const editable = !ro && l.pagador === "CABZ"; return (
                    <Fragment key={l.linea}>
                      <tr className={editable ? "lead" : undefined}>
                        <td style={{ fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap" }}>{l.linea}{l.anual ? <span className="badge" style={{ marginLeft: 6 }}>anual</span> : null}{l.transferencia ? <span className="badge" style={{ background: "var(--nec)", marginLeft: 6 }}>transf.</span> : null}</td>
                        <td className="hint" style={{ whiteSpace: "nowrap" }}>{l.subrubro ?? "—"}</td><td>{l.pagador}</td>
                        {l.meses.map((v, i) => <td key={i} className="n" style={{ color: l.pagador === "CABZ" ? "var(--gray-warm)" : "var(--gray-soft)" }}>{l.anual ? (i === 0 ? fmt(v) : "") : v ? fmt(v) : "·"}</td>)}
                        <td className="n" style={{ fontWeight: 700 }}>{fmt(tp)}</td>
                        <td rowSpan={editable ? 2 : 1} style={{ verticalAlign: "middle" }}>{tp ? <Barra plan={tp} real={tr} pf={tpf} w={tp} h={10} /> : null}</td>
                      </tr>
                      {editable && <tr className="sub"><td style={{ paddingLeft: 18 }} className="hint">real</td><td /><td />
                        {re.map((v, i) => { const sobre = v > planMes(l, i) && planMes(l, i) > 0; const sel = celda?.linea === l.linea && celda.mes === i + 1; return <td key={i} className="n" style={{ padding: "1px 3px" }}>{concil
                          ? <input type="number" defaultValue={v || ""} placeholder="·" onBlur={(e) => { const n = Number(e.target.value) || 0; if (n !== v) setRealCon(l, i + 1, n); }} style={{ width: 66, padding: "2px 4px", textAlign: "right", fontSize: 11.5, color: sobre ? "var(--neg)" : undefined, fontWeight: v ? 600 : 400 }} />
                          : <button type="button" className="link" onClick={() => setCelda2(sel ? null : { linea: l.linea, mes: i + 1 })} title="Ver / registrar gastos de este mes" style={{ width: 66, textAlign: "right", fontSize: 11.5, color: sobre ? "var(--neg)" : v ? "var(--ink)" : "var(--gray-soft)", fontWeight: v ? 600 : 400, background: sel ? "var(--cream)" : undefined, borderRadius: 4, padding: "2px 4px" }}>{v ? fmt(v) : "+"}</button>}</td>; })}
                        <td className={"n" + (tr > tpf && tpf ? " neg" : "")} style={{ fontWeight: 700 }}>{fmt(tr)}</td></tr>}
                      {editable && !concil && celda?.linea === l.linea && <tr><td colSpan={17} style={{ background: "var(--bone)", padding: "6px 10px" }}><PanelGasto l={l} mes={celda.mes} /></td></tr>}
                    </Fragment>); })}
                </Fragment>); })}
              {!ro && <tr><td colSpan={17} style={{ background: "var(--bone)" }}>{nuevaEn === "__otro__" ? <NuevaLinea padre={null} /> : <button className="link" type="button" style={{ fontSize: 11 }} onClick={() => setNuevaEn("__otro__")}>+ concepto en otro rubro</button>}</td></tr>}
              <tr className="tot"><td colSpan={3}>Pago yo · plan</td>{Array.from({ length: 12 }, (_, i) => <td key={i} className="n">{fmt(sum(mios.map((l) => planMes(l, i))))}</td>)}<td className="n">{fmt(planTotal)}</td><td /></tr>
              <tr className="tot"><td colSpan={3}>Pago yo · real</td>{Array.from({ length: 12 }, (_, i) => { const v = sum(mios.map((l) => realLinea(l)[i])); const p = sum(mios.map((l) => planMes(l, i))); return <td key={i} className={"n" + (v > p && p ? " neg" : "")}>{v ? fmt(v) : "·"}</td>; })}<td className="n">{fmt(realTotal)}</td><td>{planTotal ? <Barra plan={planTotal} real={realTotal} pf={planAFecha} w={planTotal} h={10} /> : null}</td></tr>
              {(() => { const l = lineas.find((x) => x.pagador === "HAMB"); const realLM = Array.from({ length: 12 }, (_, i) => porMes[i].lm + depLMFuera(i + 1)); const totReal = sum(realLM); return (
                <Fragment>
                  <tr className="sec"><td colSpan={17}><b>Luis Miguel</b> <span className="hint">informativo · sus depósitos</span>{!ro && <> <button className="link" type="button" style={{ fontSize: 11, marginLeft: 8 }} onClick={() => setAbrirDep(!abrirDep)}>{abrirDep ? "cancelar" : "+ depósito de Luis Miguel"}</button></>}</td></tr>
                  {abrirDep && !ro && <tr><td colSpan={17} style={{ background: "var(--bone)" }}><DepositoLM /></td></tr>}
                  {l && <tr><td style={{ fontWeight: 600, color: "var(--ink)" }}>{l.linea}</td><td className="hint">{l.subrubro ?? "—"}</td><td>HAMB</td>{l.meses.map((v, i) => <td key={i} className="n" style={{ color: "var(--gray-soft)" }}>{l.anual ? (i === 0 ? fmt(v) : "") : v ? fmt(v) : "·"}</td>)}<td className="n" style={{ fontWeight: 700 }}>{fmt(planAnual(l))}</td><td /></tr>}
                  <tr className="sub"><td style={{ paddingLeft: 18 }} className="hint">real (al fondo + a mis cuentas)</td><td /><td />{realLM.map((v, i) => <td key={i} className={"n" + (v ? " pos" : "")}>{v ? fmt(v) : "·"}</td>)}<td className="n" style={{ fontWeight: 700 }}>{fmt(totReal)}</td><td>{l && planAnual(l) ? <Barra plan={planAnual(l)} real={totReal} pf={planFecha(l)} w={planAnual(l)} h={10} /> : null}</td></tr>
                  {depLM.length > 0 && <tr><td colSpan={17} style={{ padding: "4px 10px" }}><details><summary style={{ cursor: "pointer", fontSize: 11 }}>Depósitos de Luis Miguel ({depLM.length})</summary><div className="tbl"><table style={{ fontSize: 12 }}><tbody>{depLM.map((d) => <tr key={d.id}><td>{d.fecha}</td><td>→ {d.cuenta_destino}{fondoNombres.includes(d.cuenta_destino ?? "") ? <span className="badge" style={{ marginLeft: 6 }}>fondo</span> : null}</td><td style={{ whiteSpace: "normal" }}>{d.descripcion}</td><td className="n" style={{ fontWeight: 600 }}>{fmt2(d.monto_mxn)}</td><td>{!ro && <button className="del" type="button" onClick={() => borrarDepLM(d.id)}>✕</button>}</td></tr>)}</tbody></table></div></details></td></tr>}
                </Fragment>); })()}
              <tr className="tot" style={{ color: "var(--gray-soft)" }}><td colSpan={3}>Papá y mamá cubren (informativo)</td>{Array.from({ length: 12 }, (_, i) => <td key={i} className="n">{fmt(sum(ellos.map((l) => planMes(l, i))))}</td>)}<td className="n">{fmt(planEllos)}</td><td /></tr>
            </tbody>
          </table></TablaFija>)}

        {vista === "plan" && !ro && <div className="tbl"><table>
          <thead><tr><th>Concepto</th><th>Quién</th><th className="n">Mensual</th><th className="n">Plan anual</th><th className="n">Real</th><th className="n">Plan a la fecha</th><th className="n">Desviación</th><th></th></tr></thead>
          <tbody>
            {categorias.map((c) => (
              <Fragment key={c}>
                <tr className="sec"><td colSpan={8}>{c}</td></tr>
                {lineas.filter((l) => (l.categoria ?? "Sin rubro") === c).map((l) => { const tp = planAnual(l), tr = sum(realLinea(l)), tpf = planFecha(l); const uniforme = !l.anual && l.meses.every((v) => v === l.meses[0]); const des = tr - tpf; return (
                  <Fragment key={l.linea}>
                    <tr>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{l.linea}{l.subrubro && l.subrubro !== l.linea ? <span className="hint" style={{ marginLeft: 6, fontSize: 11 }}>› {l.subrubro}</span> : null}{l.anual ? <span className="badge" style={{ marginLeft: 6 }}>anual</span> : null}{l.transferencia ? <span className="badge" style={{ background: "var(--nec)", marginLeft: 6 }}>transferencia</span> : null}{!l.rubro_id && <span className="hint" title="sin subrubro ligado: no se compara con real"> ⚠</span>}</td>
                      <td>{l.pagador}</td>
                      <td className="n">{l.anual ? <input type="number" defaultValue={tp || ""} onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && v !== tp) setAnualMonto(l, v); }} style={inp} title="Monto anual (sin mensualizar)" /> : <input type="number" defaultValue={uniforme ? l.meses[0] || "" : ""} placeholder={uniforme ? "" : "varía"} onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && (!uniforme || v !== l.meses[0])) setFila(l, v); }} style={inp} title="Se aplica a los 12 meses" />}</td>
                      <td className="n" style={{ fontWeight: 700 }}>{fmt(tp)}</td>
                      <td className={"n" + (des > 0 ? " neg" : "")}>{fmt(tr)}</td>
                      <td className="n">{fmt(tpf)}</td>
                      <td className={"n " + (des > 0 ? "neg" : des < 0 ? "pos" : "")}>{tpf ? (des > 0 ? "+" : "") + fmt(des) : "·"}</td>
                      <td style={{ whiteSpace: "nowrap" }}><button className="link" type="button" onClick={() => setAbierta(abierta === l.linea ? null : l.linea)}>{abierta === l.linea ? "cerrar" : "editar"}</button> <button className="del" type="button" onClick={() => borrarLinea(l)}>✕</button></td>
                    </tr>
                    {abierta === l.linea && (
                      <tr><td colSpan={8} style={{ background: "var(--bone)", padding: "6px 10px" }}>
                        <div className="g4" style={{ marginBottom: 6, gridTemplateColumns: "repeat(5, 1fr)" }}>
                          <div><label>Rubro</label><select value={l.categoria ?? ""} onChange={(e) => setAttr(l, "categoria", e.target.value)}><option value="">—</option>{padres.map((r) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}</select></div>
                          <div><label>Subrubro (liga el real)</label><select value={l.rubro_id ?? ""} onChange={(e) => setAttr(l, "rubro_id", e.target.value)}><option value="">— sin ligar —</option>{hijosDe(l.categoria).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></div>
                          <div><label>Quién paga</label><select value={l.pagador} onChange={(e) => setAttr(l, "pagador", e.target.value)}>{initial.pagadores.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre}</option>)}</select></div>
                          <div><label>Presupuesto anual (sin mensualizar)</label><input type="checkbox" checked={l.anual} onChange={(e) => setAttr(l, "anual", e.target.checked)} /></div>
                          <div><label>Transferencia (no es gasto)</label><input type="checkbox" checked={l.transferencia} onChange={(e) => setAttr(l, "es_transferencia", e.target.checked)} /></div>
                        </div>
                        {!l.anual && <div className="tbl"><table style={{ fontSize: 12 }}>
                          <thead><tr><th></th>{MESN.map((m) => <th key={m} className="n">{m}</th>)}<th className="n">Año</th></tr></thead>
                          <tbody><tr><td>plan</td>{l.meses.map((v, i) => <td key={i} className="n"><input type="number" defaultValue={v || ""} onBlur={(e) => Number(e.target.value) !== v && setCelda(l, i + 1, Number(e.target.value) || 0)} style={inp} /></td>)}<td className="n" style={{ fontWeight: 700 }}>{fmt(tp)}</td></tr></tbody>
                        </table></div>}
                      </td></tr>)}
                  </Fragment>); })}
              </Fragment>))}
            {!lineas.length && <tr><td colSpan={8} className="hint">Sin plan para {anio}. Agrega conceptos en la cuadrícula o propón desde el año anterior.</td></tr>}
            <tr className="tot"><td>Pago yo</td><td /><td /><td className="n">{fmt(planTotal)}</td><td className="n">{fmt(realTotal)}</td><td className="n">{fmt(planAFecha)}</td><td className={"n " + (realTotal - planAFecha > 0 ? "neg" : "pos")}>{(realTotal - planAFecha > 0 ? "+" : "") + fmt(realTotal - planAFecha)}</td><td /></tr>
          </tbody>
        </table></div>}
        {realSinLinea.length > 0 && <p className="hint">Gastos Akela {anio} sin concepto en el plan: {realSinLinea.map((r) => `${r.linea} ${fmt(r.real)}`).join(" · ")}. Agrega el concepto ligado a ese subrubro.</p>}
        <p className="hint">{concil ? `${anio}: el real se captura en la fila «real» (conciliación con tu tabla); no toca Gastos.` : `Desde 2027 la celda «real» abre los gastos del mes: los registras como en Gastos (fecha, concepto, cuenta, meses sin intereses) y van al libro Akela con el subrubro del concepto; lo que registres en Gastos aparece aquí.`} El presupuesto es lo que sale de ti: gastos directos + depósitos a papá y mamá. Sus conceptos son informativos (en qué se va el depósito) y no suman al total. Línea punteada = dónde deberías ir hoy; rojo = por arriba del plan a la fecha.</p>
      </div>
      <h2>3 · Aportaciones {anio} · yo vs Luis Miguel</h2>
      <div className="card">
        <div className="tbl"><table>
          <thead><tr><th>Mes</th><th className="n">Pagué yo (gastos + depósitos)</th><th className="n">Retiré del fondo</th><th className="n">Neto yo</th><th className="n">Luis Miguel</th><th className="n">Retiró LM</th><th className="n">Neto LM</th><th className="n">Pagaron ellos (de lo transferido)</th><th className="n">Acum. neto yo</th><th className="n">Acum. neto LM</th><th className="n">% LM</th></tr></thead>
          <tbody>
            {(() => { let ay = 0, al = 0; return porMes.filter((m) => m.yo || m.lm || m.papas || m.retYo || m.retLM).map((m) => { ay += m.netoYo; al += m.netoLM; return (
              <tr key={m.k}><td>{ml(m.k)}</td><td className="n">{fmt(m.yo)}</td><td className={"n" + (m.retYo ? " neg" : "")}>{m.retYo ? "−" + fmt(m.retYo) : "·"}</td><td className="n" style={{ fontWeight: 600 }}>{fmt(m.netoYo)}</td><td className={"n" + (m.lm ? " pos" : "")}>{m.lm ? fmt(m.lm) : "·"}</td><td className={"n" + (m.retLM ? " neg" : "")}>{m.retLM ? "−" + fmt(m.retLM) : "·"}</td><td className="n" style={{ fontWeight: 600 }}>{m.lm || m.retLM ? fmt(m.netoLM) : "·"}</td><td className="n">{m.papas ? fmt(m.papas) : "·"}</td><td className="n">{fmt(ay)}</td><td className="n">{fmt(al)}</td><td className="n">{pct(Math.max(al, 0), Math.max(ay, 0) + Math.max(al, 0))}</td></tr>); }); })()}
            <tr className="tot"><td>Año</td><td className="n">{fmt(totYo)}</td><td className="n">{totRetYo ? "−" + fmt(totRetYo) : "·"}</td><td className="n">{fmt(netoYo)}</td><td className="n">{fmt(totLM)}</td><td className="n">{totRetLM ? "−" + fmt(totRetLM) : "·"}</td><td className="n">{fmt(netoLM)}</td><td className="n">{fmt(sum(porMes.map((m) => m.papas)))}</td><td className="n">{fmt(netoYo)}</td><td className="n">{fmt(netoLM)}</td><td className="n">{pct(Math.max(netoLM, 0), Math.max(netoYo, 0) + Math.max(netoLM, 0))}</td></tr>
          </tbody>
        </table></div>
        {aportes.length > 0 && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer" }}>Depósitos al fondo ({aportes.length})</summary>
          <div className="tbl"><table><tbody>{aportes.map((a, i) => <tr key={i}><td>{a.fecha}</td><td>{a.quien ?? "CABZ"}</td><td style={{ whiteSpace: "normal" }}>{a.descripcion}</td><td className="n">{fmt2(a.entrada_mxn)}</td></tr>)}</tbody></table></div></details>}
        {retiros.length > 0 && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer" }}>Retiros del fondo ({retiros.length})</summary>
          <div className="tbl"><table><tbody>{retiros.map((a, i) => <tr key={i}><td>{a.fecha}</td><td>{a.quien ?? "CABZ"}</td><td style={{ whiteSpace: "normal" }}>{a.descripcion}</td><td className="n">{fmt2(a.salida_mxn)}</td></tr>)}</tbody></table></div></details>}
        <p className="hint">Pagado = gastos Akela con tus cuentas + depósitos al fondo. Lo que retiras del fondo a tu favor se resta: el neto es lo que realmente pusiste de tu bolsa. Luis Miguel compensa con depósitos al fondo o pagando gastos a su nombre.</p>
      </div>

      <h2>4 · Fondo Akela y proyección</h2>
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
