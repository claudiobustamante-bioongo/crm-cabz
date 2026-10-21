"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { AjusteFiscal, ContabilidadData, Obligacion } from "@/lib/types";
import { fmt, MESN } from "@/lib/format";
import { resumenInversiones, perdidasPorAmortizar, mesContab, PERDIDA_ANIOS, facturasDeducibles, DED_LABEL } from "@/lib/contab";
import { FORMA_PAGO } from "@/lib/cfdi";
import { TablaFija } from "@/components/TablaFija";
import { TablaAnual } from "@/components/inversiones/TablaAnual";

const usd = (n: number) => (n < 0 ? "-" : "") + "US$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const EST: Record<Obligacion["estado"], [string, string]> = { pendiente: ["Pendiente", "var(--gus)"], presentada: ["Presentada", "var(--nec)"], pagada: ["Pagada", "var(--aho)"], no_aplica: ["No aplica", "var(--gray-soft)"] };

export function Contabilidad({ initial, soloLectura = false }: { initial: ContabilidadData; soloLectura?: boolean }) {
  const ro = soloLectura;
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [obligaciones, setObligaciones] = useState(initial.obligaciones);
  const [ajustes, setAjustes] = useState(initial.ajustes);
  const [nuevo, setNuevo] = useState({ anio: initial.anio, tipo: "perdida_acciones" as AjusteFiscal["tipo"], concepto: "", monto: "", amortizado: "", notas: "" });
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 5000); };
  const anio = initial.anio;

  /* ---------- derivados ---------- */
  const M = (mes: number) => mesContab(initial.mensual, anio, mes);
  const sumM = (k: keyof NonNullable<ReturnType<typeof M>>) => Array.from({ length: 12 }, (_, i) => Number(M(i + 1)?.[k] ?? 0)).reduce((a, b) => a + b, 0);
  const inv = resumenInversiones(initial.ibkr, initial.cuentasIbkr, initial.tc);
  const invAnio = inv.filter((i) => i.anio === anio);
  const perdidas = perdidasPorAmortizar(inv, ajustes);
  const propias = invAnio.filter((i) => i.titular === "CABZ");
  const tot = (f: (i: typeof invAnio[number]) => number, xs = propias) => xs.reduce((a, i) => a + f(i), 0);
  const umaAnual = initial.uma * 365, tope5 = umaAnual * 5;
  const ded = (k: string) => initial.deducciones.find((d) => d.categoria === k);
  const generales = ["gmm", "medico", "funeral", "colegiatura", "hipoteca", "donativo"];
  const dedGen = generales.reduce((a, k) => a + Number(ded(k)?.con_comprobante ?? 0), 0);
  const ingresoAnual = sumM("nomina_bruto") + sumM("emitidas_subtotal");
  const topeGen = Math.min(ingresoAnual * 0.15, tope5), topePpr = Math.min(ingresoAnual * 0.1, tope5);
  const ppr = Math.max(Number(ded("ppr")?.registrado ?? 0), Number(ded("ppr")?.con_comprobante ?? 0));
  const dedFilas = facturasDeducibles(initial.cfdis, initial.rubros, initial.rfcPropio);
  const abrir = async (path: string | null) => { if (!path) return; const { data } = await supabase.storage.from("documentos").createSignedUrl(path, 300); if (data) window.open(data.signedUrl, "_blank"); };

  /* ---------- acciones ---------- */
  const descargar = async (url: string, nombre: string) => {
    setBusy(true);
    try {
      const r = await fetch(url); if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
      const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = nombre; a.click();
    } catch (e) { aviso("No se pudo descargar: " + (e as Error).message); } finally { setBusy(false); }
  };
  const recalcularNomina = async () => {
    setBusy(true);
    try { const r = await fetch("/api/cfdi/reparsear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "nomina" }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error);
      aviso(`${j.ok} recibos de nómina releídos${j.errores?.length ? ` · ${j.errores.length} con error` : ""}. Recargando…`); setTimeout(() => window.location.reload(), 1500);
    } catch (e) { aviso("No se pudo: " + (e as Error).message); } finally { setBusy(false); }
  };
  const generarCalendario = async () => {
    const { error } = await supabase.rpc("generar_obligaciones", { p_anio: anio });
    if (error) return aviso("No se generó: " + error.message + (/function/i.test(error.message) ? " (corre 21_contabilidad.sql)" : ""));
    router.refresh(); const { data } = await supabase.from("obligaciones_fiscales").select("*").eq("anio", anio).order("vence"); setObligaciones((data ?? []) as Obligacion[]);
  };
  const setObl = async (o: Obligacion, patch: Partial<Obligacion>) => {
    const { error } = await supabase.from("obligaciones_fiscales").update(patch).eq("id", o.id);
    if (error) return aviso(error.message);
    setObligaciones((p) => p.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
  };
  const agregarAjuste = async () => {
    const monto = Number(nuevo.monto); if (!monto || !nuevo.concepto.trim()) return aviso("Concepto y monto son obligatorios.");
    const row = { anio: nuevo.anio, tipo: nuevo.tipo, concepto: nuevo.concepto.trim(), monto, amortizado: Number(nuevo.amortizado) || 0, notas: nuevo.notas.trim() || null };
    const { data, error } = await supabase.from("ajustes_fiscales").insert(row).select("*").single();
    if (error) return aviso("No se guardó: " + error.message);
    setAjustes((p) => [...p, data as AjusteFiscal]); setNuevo({ ...nuevo, concepto: "", monto: "", amortizado: "", notas: "" });
  };
  const borrarAjuste = async (a: AjusteFiscal) => {
    if (!confirm(`¿Borrar "${a.concepto}"?`)) return;
    const { error } = await supabase.from("ajustes_fiscales").delete().eq("id", a.id); if (error) return aviso(error.message);
    setAjustes((p) => p.filter((x) => x.id !== a.id));
  };

  return (
    <section>
      <div className="idea"><b>Para tu contador</b> Todo lo fiscal del año en un solo lugar: ingresos por fuente, IVA mensual, inversiones por cuenta (Cap. IV, art. 142 y 143), pérdidas por amortizar, deducciones personales y calendario. Abajo a la derecha, el papel de trabajo en Excel con fórmulas, y los XML del año en ZIP.</div>

      <div className={"card" + (busy ? " spin" : "")}>
        <div className="g4">
          <div><label htmlFor="c-anio">Ejercicio</label><select id="c-anio" value={anio} onChange={(e) => router.push(`/contabilidad?anio=${e.target.value}`)}>{initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
          <div><label>RFC</label><div style={{ padding: "9px 0", fontFamily: "monospace" }}>{initial.rfcPropio ?? "—"}</div></div>
          <div><label>&nbsp;</label><button className="btn sm" type="button" style={{ width: "100%" }} disabled={busy} onClick={() => descargar(`/api/contabilidad/xlsx?anio=${anio}`, `Papel_de_trabajo_${anio}.xlsx`)}>⬇ Papel de trabajo (Excel)</button></div>
          <div><label>&nbsp;</label><button className="btn ghost sm" type="button" style={{ width: "100%" }} disabled={busy} onClick={() => descargar(`/api/contabilidad/zip?anio=${anio}`, `CFDI_${anio}.zip`)}>⬇ XML + PDF del año (ZIP)</button></div>
        </div>
        <p className="hint">Régimen: persona física con actividad empresarial (honorarios) + sueldos y salarios. El Excel trae pestañas por tema con fórmulas vivas; el ZIP, todos los CFDI del ejercicio con los PDF que haya.</p>
      </div>

      <h2>1 · Ingresos del ejercicio</h2>
      <div className="stat-row">
        <div className="stat"><div className="v">{fmt(sumM("nomina_bruto"))}</div><div className="l">Sueldos {initial.mensual.some((x) => x.anio === anio && x.nomina_de_ingresos) ? "(neto capturado)" : "brutos"} · ISR ret. {fmt(sumM("nomina_isr"))}</div></div>
        <div className="stat"><div className="v">{fmt(sumM("emitidas_subtotal"))}</div><div className="l">Honorarios facturados · {sumM("emitidas_n")} CFDI</div></div>
        <div className="stat"><div className="v">{fmt(sumM("emitidas_iva"))}</div><div className="l">IVA trasladado</div></div>
        <div className="stat"><div className="v">{fmt(sumM("emitidas_ret_isr"))}</div><div className="l">ISR retenido por clientes</div></div>
        <div className="stat"><div className="v">{fmt(tot((i) => i.mxn.div_bruto + i.mxn.cupon))}</div><div className="l">Dividendos + cupones (MXN)</div></div>
        <div className="stat"><div className={"v " + (tot((i) => i.mxn.realizada) < 0 ? "neg" : "pos")}>{fmt(tot((i) => i.mxn.realizada))}</div><div className="l">Ganancia realizada Cap. IV</div></div>
      </div>

      <div className="card">
        <div className="ct"><span>Mensual · actividad empresarial e IVA</span><span className="tag">emitidas netas de notas de crédito</span></div>
        <TablaFija fijarUltima={false}><table>
          <thead><tr><th>Mes</th><th className="n">Honorarios</th><th className="n">IVA trasladado</th><th className="n">Ret. ISR</th><th className="n">Ret. IVA</th><th className="n">Gastos facturados</th><th className="n">IVA acreditable</th><th className="n">IVA a cargo (favor)</th><th className="n">Sueldo bruto</th><th className="n">ISR nómina</th></tr></thead>
          <tbody>
            {MESN.map((m, i) => { const x = M(i + 1); if (!x) return null; const ivaNeto = x.emitidas_iva - x.emitidas_ret_iva - x.recibidas_iva_acreditable; return (
              <tr key={m}><td>{m} {String(anio).slice(2)}</td><td className="n" title={x.emitidas_de_ingresos ? "Capturado en Ingresos (sin CFDI emitido en el CRM)" : "De los CFDI emitidos"}>{fmt(x.emitidas_subtotal)}{x.emitidas_de_ingresos ? "*" : ""}</td><td className="n">{fmt(x.emitidas_iva)}</td><td className="n">{fmt(x.emitidas_ret_isr)}</td><td className="n">{fmt(x.emitidas_ret_iva)}</td>
                <td className="n"><Link href={`/facturacion/detalle?anio=${anio}&mes=${anio}-${String(i + 1).padStart(2, "0")}&tipo=recibida`} title="Ver las facturas de este mes">{fmt(x.recibidas_total)}</Link></td><td className="n">{fmt(x.recibidas_iva_acreditable)}</td><td className={"n " + (ivaNeto < 0 ? "pos" : "")}>{fmt(ivaNeto)}</td><td className="n" title={x.nomina_de_ingresos ? "Capturado en Ingresos: neto (sin CFDI de nómina, no hay bruto ni ISR)" : "Del CFDI de nómina"}>{fmt(x.nomina_bruto)}{x.nomina_de_ingresos ? "*" : ""}</td><td className="n">{x.nomina_de_ingresos ? "—" : fmt(x.nomina_isr)}</td></tr>); })}
            <tr className="tot"><td>Año</td><td className="n">{fmt(sumM("emitidas_subtotal"))}</td><td className="n">{fmt(sumM("emitidas_iva"))}</td><td className="n">{fmt(sumM("emitidas_ret_isr"))}</td><td className="n">{fmt(sumM("emitidas_ret_iva"))}</td><td className="n">{fmt(sumM("recibidas_total"))}</td><td className="n">{fmt(sumM("recibidas_iva_acreditable"))}</td><td className="n">{fmt(sumM("emitidas_iva") - sumM("emitidas_ret_iva") - sumM("recibidas_iva_acreditable"))}</td><td className="n">{fmt(sumM("nomina_bruto"))}</td><td className="n">{fmt(sumM("nomina_isr"))}</td></tr>
          </tbody>
        </table></TablaFija>
        <p className="hint">{!ro && <><button className="link" type="button" onClick={recalcularNomina} disabled={busy}>Releer XML de nómina</button> (corrige ISR y bruto de recibos ya cargados). </>}* = tomado de lo capturado en Ingresos porque ese mes no hay CFDI en el CRM (en nómina solo se conoce el neto; sube los XML de nómina para bruto e ISR). «Gastos facturados» abre las facturas del mes con sus XML, PDF y Drive. IVA acreditable = IVA de recibidas a tu RFC con uso distinto de D0x/S01; el contador decide qué es estrictamente indispensable.</p>
      </div>

      <h2>2 · Inversiones · {anio}</h2>
      <TablaAnual filas={initial.ibkr} cuentas={initial.cuentasIbkr} tc={initial.tc} anio={anio} titulo={`Resumen mensual IBKR · ${anio} · MXN al FIX (todas las cuentas)`} />
      <div className="card">
        <div className="ct"><span>Por cuenta (USD y MXN al FIX de cada mes)</span><span className="tag">art. 142 fr. V dividendos · art. 143 intereses · Cap. IV enajenación</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Cuenta</th><th className="n">Meses</th><th className="n">Realizada USD</th><th className="n">Realizada MXN</th><th className="n">Div. brutos</th><th className="n">Ret. extranjero</th><th className="n">Cupones</th><th className="n">Comisiones</th><th className="n">NAV cierre USD</th><th className="n">NAV cierre MXN</th></tr></thead>
          <tbody>
            {invAnio.map((i) => (
              <tr key={i.cuenta_id}><td>{i.cuenta}{i.titular !== "CABZ" ? <span className="badge" style={{ background: "var(--akela)", marginLeft: 6 }}>Akela</span> : ""}</td><td className="n">{i.meses}</td><td className={"n" + (i.usd.realizada < 0 ? " neg" : "")}>{usd(i.usd.realizada)}</td><td className={"n" + (i.mxn.realizada < 0 ? " neg" : "")}>{fmt(i.mxn.realizada)}</td>
                <td className="n">{fmt(i.mxn.div_bruto)}</td><td className="n">{fmt(i.mxn.div_ret)}</td><td className="n">{fmt(i.mxn.cupon)}</td><td className="n neg">{fmt(i.mxn.comisiones + i.mxn.interes)}</td><td className="n">{usd(i.usd.nav)}</td><td className="n">{fmt(i.mxn.nav)}</td></tr>))}
            {!invAnio.length && <tr><td colSpan={10} className="hint">Sin meses de IBKR en {anio}.</td></tr>}
          </tbody>
        </table></div>
        <p className="hint">Dividendos: ISR 10 % definitivo sobre el bruto (art. 142 fr. V) con acreditamiento de la retención extranjera. Cupones: interés real (art. 143). Enajenación: ganancia o pérdida Cap. IV; el detalle por tipo (ETF, acciones, opciones, forex, bonos) va en el Excel. CBZBurguer es de tus papás: se reporta aparte.</p>
      </div>

      <div className="card">
        <div className="ct"><span>Pérdidas por amortizar · todas las cuentas</span><span className="tag">art. 129: {PERDIDA_ANIOS} ejercicios</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Ejercicio</th><th>Concepto</th><th className="n">Resultado realizado</th><th className="n">Pérdida</th><th className="n">Aplicada</th><th className="n">Remanente</th><th>Vence</th><th></th></tr></thead>
          <tbody>
            {perdidas.map((p, i) => (
              <tr key={i} style={p.anio === anio ? { fontWeight: 600 } : undefined}><td>{p.anio}</td><td style={{ whiteSpace: "normal" }}>{p.concepto}</td><td className={"n" + (p.resultado < 0 ? " neg" : "")}>{p.origen === "ibkr" ? fmt(p.resultado) : "—"}</td><td className="n">{p.perdida ? fmt(p.perdida) : "·"}</td><td className="n">{p.aplicada ? fmt(p.aplicada) : "·"}</td><td className={"n" + (p.remanente ? " neg" : "")}>{p.remanente ? fmt(p.remanente) : "·"}</td><td>{p.vence || ""}</td>
                <td>{!ro && p.origen === "ajuste" && <button className="del" type="button" onClick={() => { const a = ajustes.find((x) => x.anio === p.anio && x.concepto === p.concepto); if (a) borrarAjuste(a); }}>✕</button>}</td></tr>))}
            {!perdidas.length && <tr><td colSpan={8} className="hint">Sin resultados realizados aún.</td></tr>}
          </tbody>
        </table></div>
        {!ro && (<>
        <div className="g4" style={{ marginTop: 8 }}>
          <div><label htmlFor="a-anio">Ajuste · ejercicio</label><input id="a-anio" type="number" value={nuevo.anio} onChange={(e) => setNuevo({ ...nuevo, anio: +e.target.value })} /></div>
          <div><label htmlFor="a-tipo">Tipo</label><select id="a-tipo" value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as AjusteFiscal["tipo"] })}><option value="perdida_acciones">Pérdida acciones/ETF (previa)</option><option value="perdida_actividad">Pérdida actividad empresarial</option><option value="otro">Otro ajuste</option></select></div>
          <div><label htmlFor="a-con">Concepto</label><input id="a-con" type="text" value={nuevo.concepto} onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })} placeholder="p. ej. pérdida 2022 declarada" /></div>
          <div><label htmlFor="a-monto">Monto MXN · ya amortizado</label><div style={{ display: "flex", gap: 6 }}><input id="a-monto" type="number" value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} /><input type="number" value={nuevo.amortizado} onChange={(e) => setNuevo({ ...nuevo, amortizado: e.target.value })} placeholder="0" /></div></div>
        </div>
        <div className="center" style={{ marginTop: 6 }}><button className="btn ghost sm" type="button" onClick={agregarAjuste}>+ Agregar ajuste</button></div>
        </>)}
        <p className="hint">Los años con resultado realizado negativo generan pérdida que se aplica sola contra ganancias de ejercicios siguientes. Para pérdidas declaradas antes de que existiera el CRM (o correcciones del contador), agrégalas aquí con lo ya amortizado.</p>
      </div>

      <h2>3 · Deducciones personales · {anio}</h2>
      <div className="stat-row">
        <div className="stat"><div className="v">{fmt(dedGen)}</div><div className="l">Médicos y seguros (CFDI) · tope {fmt(topeGen)}</div></div>
        <div className="stat"><div className="v">{fmt(ppr)}</div><div className="l">PPR / AFORE · tope {fmt(topePpr)}</div></div>
        <div className="stat"><div className="v pos">{fmt(Math.min(dedGen, topeGen) + Math.min(ppr, topePpr))}</div><div className="l">Total deducible</div></div>
        <div className="stat"><div className="v">{fmt(ingresoAnual)}</div><div className="l">Base (sueldo bruto + honorarios)</div></div>
      </div>
      <div className="card">
        <div className="ct"><span>Detalle de lo que se deduce</span><span className="tag">una fila por factura · XML · PDF · Drive · gasto ligado</span></div>
        <TablaFija fijarUltima={false} fontSize={12}><table>
          <thead><tr><th>Categoría (art. 151)</th><th>Fecha</th><th>Emisor</th><th>RFC</th><th>Concepto del CFDI</th><th>Uso</th><th>Forma de pago</th><th>Rubro en Gastos</th><th>Gasto ligado</th><th className="n">Total MXN</th><th>UUID</th><th>Archivos</th></tr></thead>
          <tbody>
            {Object.entries(dedFilas.reduce<Record<string, typeof dedFilas>>((a, f) => { (a[f.cat] ??= []).push(f); return a; }, {})).map(([cat, fs]) => (
              <Fragment key={cat}>
                <tr className="sec"><td colSpan={12}>{DED_LABEL[cat] ?? cat} · {fs.filter((f) => !f.anulada).length} facturas · {fmt(fs.filter((f) => !f.anulada).reduce((a, f) => a + f.c.total_mxn, 0))}</td></tr>
                {fs.map(({ c, anulada }) => (
                  <tr key={c.uuid} style={anulada ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                    <td></td><td>{c.fecha}</td><td style={{ whiteSpace: "normal", maxWidth: 180 }}>{c.emisor_nombre}</td><td>{c.emisor_rfc}</td><td style={{ whiteSpace: "normal", maxWidth: 260 }}>{c.concepto}</td><td>{c.uso_cfdi}</td>
                    <td>{c.forma_pago ? FORMA_PAGO[c.forma_pago] ?? c.forma_pago : ""}</td><td>{c.grupo} › {c.rubro}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 160 }}>{c.movimiento ? `${c.movimiento_fecha} · ${c.movimiento} · ${c.cuenta}` : <span className="hint">sin gasto ligado</span>}</td>
                    <td className="n">{fmt(c.total_mxn)}{anulada ? " (anulada)" : ""}</td><td style={{ fontFamily: "monospace", fontSize: 11 }}>{c.uuid.toUpperCase()}</td>
                    <td style={{ whiteSpace: "nowrap" }}><button className="link" type="button" onClick={() => abrir(c.xml_path)}>XML</button>{c.pdf_path && <> · <button className="link" type="button" onClick={() => abrir(c.pdf_path)}>PDF</button></>}{c.link_drive && <> · <a href={c.link_drive} target="_blank" rel="noreferrer">Drive ↗</a></>}</td>
                  </tr>))}
              </Fragment>))}
            {!dedFilas.length && <tr><td colSpan={12} className="hint">Sin facturas deducibles en {anio}.</td></tr>}
          </tbody>
        </table></TablaFija>
        <p className="hint">Requisitos que revisa el contador: factura a tu RFC, pagada con medio distinto a efectivo (forma de pago 01 no deduce salvo hospital/medicinas), vigente en el SAT. Las tachadas están anuladas por nota de crédito. PPR/AFORE se acreditan con la constancia anual de la operadora, no con CFDI.</p>
      </div>

      <h2>4 · Calendario fiscal · {anio}</h2>
      <div className="card">
        <div className="ct"><span>Obligaciones</span>{!ro && !obligaciones.length && <button className="btn ghost sm" type="button" onClick={generarCalendario}>Generar calendario {anio}</button>}</div>
        <div className="tbl"><table>
          <thead><tr><th>Periodo</th><th>Obligación</th><th>Vence</th><th>Estado</th><th className="n">Monto</th><th>Notas</th></tr></thead>
          <tbody>
            {obligaciones.map((o) => (
              <tr key={o.id} style={o.estado === "pendiente" && o.vence < new Date().toISOString().slice(0, 10) ? { color: "var(--deu)" } : undefined}>
                <td>{MESN[o.mes - 1]} {String(o.anio).slice(2)}</td><td style={{ whiteSpace: "normal" }}>{o.obligacion}</td><td>{o.vence}</td>
                <td>{ro ? <span className="badge" style={{ background: EST[o.estado][1] }}>{EST[o.estado][0]}</span> : <select value={o.estado} onChange={(e) => setObl(o, { estado: e.target.value as Obligacion["estado"] })} style={{ padding: "3px 5px", fontSize: 12, background: EST[o.estado][1] }}>{(Object.keys(EST) as Obligacion["estado"][]).map((k) => <option key={k} value={k}>{EST[k][0]}</option>)}</select>}</td>
                <td className="n">{ro ? (o.monto != null ? fmt(o.monto) : "") : <input type="number" defaultValue={o.monto ?? ""} onBlur={(e) => Number(e.target.value) !== (o.monto ?? 0) && setObl(o, { monto: Number(e.target.value) || null })} style={{ padding: "3px 5px", fontSize: 12, width: 100, textAlign: "right" }} />}</td>
                <td>{ro ? o.notas ?? "" : <input type="text" defaultValue={o.notas ?? ""} onBlur={(e) => e.target.value !== (o.notas ?? "") && setObl(o, { notas: e.target.value || null })} style={{ padding: "3px 5px", fontSize: 12, width: 160 }} />}</td>
              </tr>))}
            {!obligaciones.length && <tr><td colSpan={6} className="hint">Pulsa «Generar calendario»: pagos provisionales ISR/IVA (día 17), DIOT y declaración anual.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {!ro && <><h2>5 · Accesos</h2>
      <div className="card"><p className="hint" style={{ margin: 0 }}>Para dar acceso al contador: Supabase → Authentication → Users → <b>Invite user</b> con su correo; luego corre en SQL: <code>insert into accesos (user_id, rol, nombre) select id, &apos;contador&apos;, &apos;Nombre&apos; from auth.users where email = &apos;su@correo.com&apos;;</code>. Entra con ese correo en crm-cabz.vercel.app y ve solo Contabilidad y Facturación, sin poder cambiar nada. Para quitarlo: <code>delete from accesos where user_id = (select id from auth.users where email = &apos;su@correo.com&apos;);</code></p></div></>}

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
