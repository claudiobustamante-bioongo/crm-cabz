"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CfdiIngreso, Ingreso, IngresosData, TipoIngreso } from "@/lib/types";
import { subirCfdi } from "@/lib/cfdi-upload";
import { MESN, fmt, fmt2, hoy, mesKey, ml, niceStep } from "@/lib/format";

const TIPOS: { k: TipoIngreso; l: string }[] = [
  { k: "sueldo", l: "Sueldo" }, { k: "comision", l: "Comisión" }, { k: "bono", l: "Bono" },
  { k: "dividendo_interes", l: "Dividendo / interés" }, { k: "reembolso", l: "Reembolso" },
  { k: "aportacion_akela", l: "Aportación Akela" }, { k: "otro", l: "Otro" },
];
const LABEL = Object.fromEntries(TIPOS.map((t) => [t.k, t.l])) as Record<TipoIngreso, string>;
/** Entradas tuyas = todo menos reembolsos (devuelven un gasto) y aportaciones al fondo (no son tuyas). */
const esEntrada = (i: Ingreso) => !["reembolso", "aportacion_akela"].includes(i.tipo);

export function Ingresos({ initial }: { initial: IngresosData }) {
  const router = useRouter();
  const supabase = createClient();
  const [ings, setIngs] = useState<Ingreso[]>(initial.ingresos);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 3500); };

  /* ---------- defaults a partir de lo capturado ---------- */
  const ultSueldo = useMemo(() => ings.find((i) => i.tipo === "sueldo" && !i.proyectado)?.monto ?? ings.find((i) => i.tipo === "sueldo")?.monto ?? 0, [ings]);
  const destinos = initial.cuentas.filter((c) => !["tarjeta_credito", "prestamo"].includes(c.tipo));

  /* ---------- formulario ---------- */
  const [tipo, setTipo] = useState<TipoIngreso>("sueldo");
  const [monto, setMonto] = useState(String(ultSueldo || ""));
  const [fecha, setFecha] = useState(hoy());
  const [cuenta, setCuenta] = useState("Cheques");
  const [nota, setNota] = useState("Nómina Cordada");
  const [bruto, setBruto] = useState("");
  const [pm, setPm] = useState(true);
  const [cliente, setCliente] = useState("");
  const [aporta, setAporta] = useState("HAMB");
  const [proy, setProy] = useState(false);
  const [msg, setMsg] = useState("");

  const iva = (+bruto || 0) * 0.16, rISR = pm ? (+bruto || 0) * 0.1 : 0, rIVA = pm ? iva * (2 / 3) : 0;
  const netoCom = (+bruto || 0) + iva - rISR - rIVA;

  const elegirTipo = (t: TipoIngreso) => {
    setTipo(t); setMsg("");
    if (t === "sueldo") { setMonto(String(ultSueldo || "")); setNota("Nómina Cordada"); setCuenta("Cheques"); }
    else if (t === "bono") { setMonto(String(ultSueldo * 2 || "")); setNota("Bono anual (2 meses de sueldo)"); setCuenta("Cheques"); }
    else if (t === "comision") { setMonto(""); setNota("Asesoría"); setCuenta("Cheques"); }
    else if (t === "aportacion_akela") { setMonto(""); setNota("Depósito al fondo"); }
    else if (t === "reembolso") { setMonto(""); setNota("Cordada · viáticos"); setCuenta("Cheques"); }
    else { setMonto(""); setNota(""); }
  };

  const agregar = async () => {
    const m = tipo === "comision" ? Math.round(netoCom * 100) / 100 : Number(monto);
    if (!m || m <= 0) { setMsg(tipo === "comision" ? "Escribe los honorarios." : "Escribe el monto."); return; }
    setMsg(""); setBusy(true);
    try {
      const p: Record<string, unknown> = { tipo, fecha, monto: m, descripcion: nota || LABEL[tipo], proyectado: proy };
      if (tipo === "aportacion_akela") { p.aporta = aporta; if (aporta === "CABZ") p.cuenta = "Cheques"; }
      else p.cuenta = cuenta;
      if (tipo === "comision") { p.bruto = +bruto; p.persona_moral = pm; p.cliente = cliente || null; }
      const { data, error } = await supabase.rpc("registrar_ingreso", { p });
      if (error) throw error;
      const { data: row, error: e2 } = await supabase.from("v_ingresos").select("*").eq("id", data as string).single();
      if (e2) throw e2;
      // la función borra la proyección del mismo mes y tipo: reflejarlo
      setIngs((prev) => [row as Ingreso, ...prev.filter((x) => !(x.proyectado && x.tipo === tipo && mesKey(x.fecha) === mesKey(fecha) && !proy))]);
      setFmes(mesKey(fecha));
      aviso(`${LABEL[tipo]} ${fmt(m)} registrado${proy ? " (proyectado)" : ""}.`);
      if (tipo !== "sueldo") setMonto(""); if (tipo === "comision") setBruto("");
      if (+fecha.slice(0, 4) !== initial.anio) router.push(`/ingresos?anio=${fecha.slice(0, 4)}`);
    } catch (e) { aviso("No se guardó: " + (e as Error).message); }
    finally { setBusy(false); }
  };

  /* ---------- CFDI del ingreso: subir o ligar uno ya cargado, y comprobar el monto ---------- */
  const [libres, setLibres] = useState<CfdiIngreso[]>(initial.cfdisLibres);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const cuadra = (i: Ingreso, c: { total: number }) => Math.abs(c.total - i.monto) < 1;
  const candidatos = (i: Ingreso) => libres.filter((c) => (i.tipo === "sueldo" ? c.tipo === "nomina" : c.tipo === "emitida") && (cuadra(i, c) || mesKey(c.fecha) === mesKey(i.fecha))).sort((a, b) => Number(cuadra(i, b)) - Number(cuadra(i, a)));
  const ligar = async (i: Ingreso, c: { uuid: string; total: number; fecha: string }) => {
    const { error } = await supabase.rpc("ligar_cfdi", { p_uuid: c.uuid, p_mov: i.id });
    if (error) return aviso("No se ligó: " + error.message);
    setIngs((prev) => prev.map((x) => x.id === i.id ? { ...x, tiene_cfdi: true, cfdi_uuid: c.uuid } : x));
    setLibres((prev) => prev.filter((x) => x.uuid !== c.uuid));
    const dif = Math.round((c.total - i.monto) * 100) / 100;
    aviso(dif === 0 ? `CFDI ligado · cuadra exacto con ${fmt(i.monto)}.` : `CFDI ligado · OJO: el CFDI dice ${fmt2(c.total)} y registraste ${fmt2(i.monto)} (dif. ${dif > 0 ? "+" : ""}${fmt2(dif)}).`);
  };
  const subirYLigar = async (i: Ingreso, files: FileList | null) => {
    if (!files?.length) return;
    const xml = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".xml")); const pdf = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!xml) return aviso("Sube el XML del CFDI (el PDF es opcional).");
    setSubiendo(i.id); setBusy(true);
    try {
      const { p } = await subirCfdi(supabase, initial.userId, initial.rfcPropio, xml, pdf);
      const esperado = i.tipo === "sueldo" ? "nomina" : "emitida";
      if (p.tipo !== esperado) { aviso(`Ese CFDI es ${p.tipo}, no ${esperado === "nomina" ? "de nómina" : "una factura emitida por ti"}. Quedó guardado en Facturación sin ligar.`); return; }
      await ligar(i, { uuid: p.uuid, total: p.total, fecha: p.fecha });
    } catch (e) { aviso("No se subió: " + (e as Error).message); }
    finally { setSubiendo(null); setBusy(false); }
  };
  const borrar = async (i: Ingreso) => {
    if (!confirm(`¿Borrar ${LABEL[i.tipo]} ${fmt(i.monto)} del ${i.fecha}?`)) return;
    const { error } = await supabase.from("movimientos").delete().eq("id", i.id);
    if (error) return aviso("No se borró: " + error.message);
    setIngs((prev) => prev.filter((x) => x.id !== i.id));
  };

  /* ---------- derivados ---------- */
  const meses = useMemo(() => [...new Set([...ings.map((i) => mesKey(i.fecha)), ...initial.salidas.map((s) => s.mes)])].sort(), [ings, initial.salidas]);
  const [fmes, setFmes] = useState<string>(() => {
    const reales = [...new Set(initial.salidas.map((s) => s.mes))].sort();
    return reales.at(-1) ?? "all";
  });
  const enRango = (k: string) => fmes === "all" || k === fmes;
  const inM = ings.filter((i) => enRango(mesKey(i.fecha)) && esEntrada(i));
  const tin = inM.reduce((a, i) => a + i.monto_mxn, 0);
  const tproy = inM.filter((i) => i.proyectado).reduce((a, i) => a + i.monto_mxn, 0);
  const tout = initial.salidas.filter((s) => enRango(s.mes)).reduce((a, s) => a + s.total, 0);

  // por mes del año: [sueldo+bono+otros, comisiones, salidas]
  const by = Array.from({ length: 12 }, () => [0, 0, 0]);
  ings.forEach((i) => { if (!esEntrada(i)) return; by[+i.fecha.slice(5, 7) - 1][i.tipo === "comision" ? 1 : 0] += i.monto_mxn; });
  initial.salidas.forEach((s) => { by[+s.mes.slice(5, 7) - 1][2] += s.total; });
  const proyMes = Array.from({ length: 12 }, (_, i) => ings.some((x) => x.proyectado && +x.fecha.slice(5, 7) - 1 === i));

  const lista = ings.filter((i) => enRango(mesKey(i.fecha))).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const com = ings.filter((i) => i.tipo === "comision" && !i.proyectado);
  const S = (k: "bruto" | "iva" | "ret_isr" | "ret_iva" | "monto") => com.reduce((a, i) => a + Number(i[k] ?? 0), 0);
  const aportes = ings.filter((i) => i.tipo === "aportacion_akela");

  /* ---------- gráfica ---------- */
  const W = 760, H = 200, P = { l: 54, r: 8, t: 10, b: 24 };
  const mx = Math.max(...by.map((b) => Math.max(b[0] + b[1], b[2])), 1), step = niceStep(mx), max = Math.ceil(mx / step) * step;
  const bw = (W - P.l - P.r) / 12, y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  const grid: number[] = []; for (let v = 0; v <= max; v += step) grid.push(v);

  let acum = 0;

  return (
    <section>
      <div className="idea"><b>Cómo funciona</b>Sueldo y comisiones se capturan a mano cuando llegan; el CFDI se sube en <em>Facturación</em> y queda ligado. El bono se proyecta como dos meses de sueldo hasta que cae. Abajo: entradas − salidas del mes, tu liquidez mes a mes y lo fiscal de las comisiones.</div>

      <div className={"card" + (busy ? " spin" : "")}>
        <div className="ct">Registrar un ingreso</div>
        <div className="pills">
          {TIPOS.map((t) => <button key={t.k} type="button" className="pill" aria-pressed={tipo === t.k} onClick={() => elegirTipo(t.k)}>{t.l}</button>)}
        </div>
        {tipo === "comision" && (
          <div className="g4">
            <div><label htmlFor="i-bruto">Honorarios (subtotal)</label><input id="i-bruto" type="number" inputMode="decimal" value={bruto} onChange={(e) => setBruto(e.target.value)} placeholder="30000" /></div>
            <div><label htmlFor="i-pm">Receptor</label>
              <select id="i-pm" value={pm ? "1" : "0"} onChange={(e) => setPm(e.target.value === "1")}>
                <option value="1">Persona moral (retiene)</option><option value="0">Persona física</option>
              </select></div>
            <div><label>IVA · retenciones</label><div style={{ padding: "10px 0", fontSize: 13 }}>IVA {fmt(iva)} · ret ISR {fmt(rISR)} · ret IVA {fmt(rIVA)}</div></div>
            <div><label>Neto que llega</label><div style={{ padding: "10px 0", fontWeight: 700, color: "var(--green-deep)" }}>{fmt2(netoCom)}</div></div>
          </div>
        )}
        {tipo === "aportacion_akela" && (
          <div className="g2">
            <div><label htmlFor="i-quien">¿Quién aporta?</label>
              <select id="i-quien" value={aporta} onChange={(e) => setAporta(e.target.value)}>
                {initial.pagadores.filter((p) => p.codigo !== "CABU" && p.codigo !== "MPZB").map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo === "CABZ" ? "Yo (transferencia desde Cheques)" : p.nombre}</option>)}
              </select></div>
            <div><label>&nbsp;</label><p className="hint">Entra al Fondo Akela y suma en «quién pone qué». Lo que pagas tú directo de Akela ya cuenta como aportación.</p></div>
          </div>
        )}
        <div className="g3">
          {tipo !== "comision" && (
            <div><label htmlFor="i-monto">{tipo === "aportacion_akela" ? "Monto depositado" : "Monto neto recibido"}</label>
              <input id="i-monto" type="number" inputMode="decimal" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} /></div>
          )}
          {tipo === "comision" && (
            <div><label htmlFor="i-cli">Cliente <span className="h">(opcional)</span></label><input id="i-cli" type="text" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
          )}
          <div><label htmlFor="i-fecha">Fecha</label><input id="i-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          {tipo !== "aportacion_akela" ? (
            <div><label htmlFor="i-cta">Entró a</label>
              <select id="i-cta" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                {destinos.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select></div>
          ) : <div />}
        </div>
        <div className="g2">
          <div><label htmlFor="i-nota">Nota</label><input id="i-nota" type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nómina Cordada · octubre" /></div>
          <div><label>&nbsp;</label>
            <div className="pills" style={{ marginTop: 0 }}>
              <button type="button" className="pill" aria-pressed={!proy} onClick={() => setProy(false)}>Ya llegó</button>
              <button type="button" className="pill" aria-pressed={proy} onClick={() => setProy(true)}>Proyectado <span className="h">(se reemplaza al capturar)</span></button>
            </div></div>
        </div>
        {msg && <div className="err" role="alert">{msg}</div>}
        <div className="center"><button className="btn" type="button" onClick={agregar} disabled={busy}>+ Agregar ingreso</button></div>
      </div>

      <h2>Entradas y salidas</h2>
      <div className="g2" style={{ marginBottom: 6 }}>
        <div><label htmlFor="if-anio">Año</label>
          <select id="if-anio" value={initial.anio} onChange={(e) => router.push(`/ingresos?anio=${e.target.value}`)}>
            {initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></div>
        <div><label htmlFor="if-mes">Ver</label>
          <select id="if-mes" value={fmes} onChange={(e) => setFmes(e.target.value)}>
            <option value="all">Todo {initial.anio}</option>
            {meses.map((k) => <option key={k} value={k}>{ml(k)}</option>)}
          </select></div>
      </div>
      <div className="stat-row">
        <div className="stat"><div className="v pos">{fmt(tin)}</div><div className="l">Entradas{tproy ? ` · ${fmt(tproy)} proyectado` : ""}</div></div>
        <div className="stat"><div className="v neg">{fmt(tout)}</div><div className="l">Salidas (gastos + Akela + ahorro + deuda)</div></div>
        <div className="stat"><div className={"v " + (tin - tout < 0 ? "neg" : "pos")}>{fmt(tin - tout)}</div><div className="l">Queda</div></div>
        <div className="stat"><div className="v">{tin ? Math.round(((tin - tout) / tin) * 100) : 0}%</div><div className="l">del ingreso</div></div>
      </div>

      <div className="card">
        <div className="ct"><span>Por mes · {initial.anio}</span>
          <span className="legend"><span><i style={{ background: "var(--nec)" }} />sueldo, bono y otros</span><span><i style={{ background: "var(--c6)" }} />comisiones</span><span><i style={{ background: "var(--deu)" }} />salidas</span></span></div>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Entradas y salidas por mes">
          {grid.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end">{v >= 1000 ? Math.round(v / 1000) + "k" : v}</text></g>)}
          {by.map((b, i) => {
            const x = P.l + i * bw + bw * 0.12, w = bw * 0.34;
            return (
              <g key={i}>
                <rect x={x} y={y(b[0])} width={w} height={y(0) - y(b[0])} fill="var(--nec)" opacity={proyMes[i] ? 0.45 : 1} stroke="var(--ink)" strokeWidth={0.6}><title>{`${MESN[i]} sueldo/bono ${fmt(b[0])}`}</title></rect>
                <rect x={x} y={y(b[0] + b[1])} width={w} height={y(b[0]) - y(b[0] + b[1])} fill="var(--c6)" stroke="var(--ink)" strokeWidth={0.6}><title>{`${MESN[i]} comisiones ${fmt(b[1])}`}</title></rect>
                <rect x={x + w + 3} y={y(b[2])} width={w} height={y(0) - y(b[2])} fill="var(--deu)" opacity={0.85} stroke="var(--ink)" strokeWidth={0.6}><title>{`${MESN[i]} salidas ${fmt(b[2])}`}</title></rect>
                <text x={x + w} y={H - 7} textAnchor="middle">{MESN[i]}</text>
              </g>
            );
          })}
        </svg>
        <p className="hint">Salidas = todo lo real registrado en Gastos (incluye Akela, ahorro y deuda). Meses con ingreso proyectado en tono claro.</p>
      </div>

      <div className="card">
        <div className="ct"><span>Liquidez mes a mes</span><span className="tag">entradas − salidas · acumulado del año</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Mes</th><th className="n">Entradas</th><th className="n">Salidas</th><th className="n">Queda</th><th className="n">Acumulado</th><th className="n">% del ingreso</th></tr></thead>
          <tbody>
            {by.map((b, i) => {
              const k = `${initial.anio}-${String(i + 1).padStart(2, "0")}`;
              const ent = b[0] + b[1], sal = b[2], q = ent - sal;
              if (!ent && !sal) return null;
              acum += q;
              return (
                <tr key={k} style={proyMes[i] ? { opacity: 0.6 } : undefined}>
                  <td>{ml(k)}{proyMes[i] && <> <span className="badge" style={{ background: "var(--gray-soft)" }}>proy.</span></>}</td>
                  <td className="n pos">{fmt(ent)}</td><td className="n neg">{fmt(sal)}</td>
                  <td className={"n " + (q < 0 ? "neg" : "pos")} style={{ fontWeight: 700 }}>{fmt(q)}</td>
                  <td className={"n " + (acum < 0 ? "neg" : "")}>{fmt(acum)}</td>
                  <td className="n">{ent ? Math.round((q / ent) * 100) : 0}%</td>
                </tr>
              );
            })}
            <tr className="tot"><td>Año</td><td className="n">{fmt(by.reduce((a, b) => a + b[0] + b[1], 0))}</td><td className="n">{fmt(by.reduce((a, b) => a + b[2], 0))}</td><td className="n">{fmt(by.reduce((a, b) => a + b[0] + b[1] - b[2], 0))}</td><td /><td className="n">{(() => { const e = by.reduce((a, b) => a + b[0] + b[1], 0); return e ? Math.round((by.reduce((a, b) => a + b[0] + b[1] - b[2], 0) / e) * 100) : 0; })()}%</td></tr>
          </tbody>
        </table></div>
      </div>

      <div className="g2">
        <div className="card">
          <div className="ct">Ingresos registrados</div>
          {lista.length === 0 && <p className="hint">Sin ingresos.</p>}
          {lista.map((i) => (
            <div key={i.id} className="mov" style={i.proyectado ? { opacity: 0.6 } : undefined}>
              <span>
                <b style={{ color: "var(--ink)" }}>{LABEL[i.tipo]}</b> · {i.descripcion}{i.aporta_nombre ? ` · ${i.aporta_nombre}` : ""}{" "}
                <span style={{ color: "var(--gray-soft)", fontSize: 12 }}>{i.fecha.slice(8, 10)} {ml(i.fecha)}</span>
                {i.proyectado && <> <span className="badge" style={{ background: "var(--gray-soft)" }}>proyectado</span></>}
                {["sueldo", "comision"].includes(i.tipo) && !i.proyectado && (i.tiene_cfdi
                  ? <> <span className="badge" style={{ background: "var(--nec)" }} title={i.cfdi_uuid ?? ""}>CFDI ✓</span></>
                  : <> <label className="badge" style={{ background: "var(--gus)", cursor: "pointer" }} title="Sube el XML (y PDF) del CFDI para ligarlo y comprobar el monto">{subiendo === i.id ? "subiendo…" : "CFDI pendiente · subir XML"}<input type="file" accept=".xml,.pdf" multiple style={{ display: "none" }} onChange={(e) => { subirYLigar(i, e.target.files); e.target.value = ""; }} /></label>
                    {candidatos(i).slice(0, 2).map((c) => <button key={c.uuid} className="link" type="button" style={{ fontSize: 11, marginLeft: 6 }} onClick={() => ligar(i, c)} title={`${c.emisor_nombre ?? ""} · ${c.fecha} · ${fmt2(c.total)}`}>ligar CFDI {c.fecha.slice(5)} {fmt(c.total)}{cuadra(i, c) ? " ✓" : " ⚠"}</button>)}</>
                )}
              </span>
              <span className="r">
                <span className="b" style={{ background: "var(--aho)" }}>{i.cuenta_destino ?? i.cuenta}</span>
                <b style={{ color: "var(--ink)" }}>{fmt(i.monto_mxn)}</b>
                <button className="del" type="button" aria-label="Borrar" onClick={() => borrar(i)}>✕</button>
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="card">
            <div className="ct">Comisiones · fiscal {initial.anio}</div>
            <div className="tbl"><table><tbody>
              <tr><td>Honorarios facturados</td><td className="n">{fmt(S("bruto"))}</td></tr>
              <tr><td>IVA trasladado</td><td className="n">{fmt(S("iva"))}</td></tr>
              <tr><td>ISR retenido (acreditable)</td><td className="n">{fmt(S("ret_isr"))}</td></tr>
              <tr><td>IVA retenido</td><td className="n">{fmt(S("ret_iva"))}</td></tr>
              <tr className="tot"><td>Neto recibido</td><td className="n">{fmt(S("monto"))}</td></tr>
              <tr><td>ISR provisional estimado</td><td className="n neg">{fmt(S("bruto") * 0.35 - S("ret_isr"))}</td></tr>
            </tbody></table></div>
            <p className="hint">ISR retenido se acredita en la anual. Provisional estimado = 35% sobre honorarios − retenido.</p>
          </div>
          <div className="card">
            <div className="ct">Aportaciones al Fondo Akela · {initial.anio}</div>
            {aportes.length === 0 && <p className="hint">Sin depósitos registrados.</p>}
            {Object.entries(aportes.reduce<Record<string, number>>((o, i) => ((o[i.aporta_nombre ?? "—"] = (o[i.aporta_nombre ?? "—"] ?? 0) + i.monto_mxn), o), {})).map(([n, v]) => (
              <div key={n} className="catbar"><div className="lbl"><span>{n}</span><span>{fmt(v)}</span></div></div>
            ))}
            <p className="hint">Lo que pagas directo de Akela se ve en la pestaña Akela como tu aportación.</p>
          </div>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
