"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Cfdi, FacturacionData, GastoSinCfdi } from "@/lib/types";
import { fmt, fmt2, mesKey, ml } from "@/lib/format";
import { parseCfdi, FORMA_PAGO } from "@/lib/cfdi";

const TIPO_LABEL = { emitida: "Emitida", recibida: "Recibida", nomina: "Nómina" } as const;
const TIPO_COLOR = { emitida: "var(--c6)", recibida: "var(--aho)", nomina: "var(--nec)" } as const;
const ESTADO = { nueva: ["Por ligar", "var(--gus)"], ligada: ["Ligada", "var(--nec)"], revisar: ["Revisar", "var(--deu)"], sin_gasto: ["Sin gasto", "var(--gray-soft)"] } as const;
const DED_LABEL: Record<string, string> = { gmm: "Primas de gastos médicos mayores", medico: "Honorarios médicos, dentales y hospital", ppr: "Aportaciones a PPR / AFORE voluntaria", funeral: "Gastos funerarios", colegiatura: "Colegiaturas", hipoteca: "Intereses hipotecarios", donativo: "Donativos" };

export function Facturacion({ initial }: { initial: FacturacionData }) {
  const router = useRouter();
  const supabase = createClient();
  const [cfdis, setCfdis] = useState<Cfdi[]>(initial.cfdis);
  const [sinCfdi, setSinCfdi] = useState<GastoSinCfdi[]>(initial.sinCfdi);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [ftipo, setFtipo] = useState(""); const [fmes, setFmes] = useState(""); const [festado, setFestado] = useState(""); const [q, setQ] = useState("");
  const [ligando, setLigando] = useState<Cfdi | null>(null);
  const [creando, setCreando] = useState<Cfdi | null>(null);
  const [cCuenta, setCCuenta] = useState(initial.cuentas.find((c) => c.nombre === "AMEX")?.id ?? initial.cuentas[0]?.id ?? "");
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 4500); };
  const grupos = initial.rubros.filter((r) => !r.padre_id);
  const subsDe = (gid: string) => initial.rubros.filter((r) => r.padre_id === gid);

  /* ---------- subir XML / PDF ---------- */
  const subir = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    const lista = Array.from(files);
    const xmls = lista.filter((f) => f.name.toLowerCase().endsWith(".xml"));
    const pdfs = lista.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    let ok = 0, dup = 0; const errs: string[] = [];
    try {
      for (const f of xmls) {
        try {
          const p = parseCfdi(await f.text(), initial.rfcPropio);
          if (cfdis.some((c) => c.uuid === p.uuid)) { dup++; continue; }
          const anio = p.fecha.slice(0, 4), base = `${initial.userId}/cfdi/${anio}/${p.uuid}`;
          const { error: e1 } = await supabase.storage.from("documentos").upload(`${base}.xml`, f, { contentType: "text/xml", upsert: true });
          if (e1) throw e1;
          const { data: dx, error: e2 } = await supabase.from("documentos").upsert({ nombre: f.name, storage_path: `${base}.xml`, mime: "text/xml", tamano_bytes: f.size, categoria: "cfdi", fecha_documento: p.fecha }, { onConflict: "storage_path" }).select("id").single();
          if (e2) throw e2;
          // PDF con el mismo nombre base (o que contenga el UUID)
          const stem = f.name.replace(/\.xml$/i, "").toLowerCase();
          const pdf = pdfs.find((x) => x.name.toLowerCase().replace(/\.pdf$/, "") === stem || x.name.toLowerCase().includes(p.uuid));
          let pdfId: string | null = null;
          if (pdf) {
            const { error: e3 } = await supabase.storage.from("documentos").upload(`${base}.pdf`, pdf, { contentType: "application/pdf", upsert: true });
            if (!e3) { const { data: dp } = await supabase.from("documentos").upsert({ nombre: pdf.name, storage_path: `${base}.pdf`, mime: "application/pdf", tamano_bytes: pdf.size, categoria: "cfdi", fecha_documento: p.fecha }, { onConflict: "storage_path" }).select("id").single(); pdfId = dp?.id ?? null; }
          }
          const row = {
            uuid: p.uuid, tipo: p.tipo, tipo_comprobante: p.tipo_comprobante, fecha: p.fecha, serie: p.serie, folio: p.folio,
            emisor_rfc: p.emisor_rfc, emisor_nombre: p.emisor_nombre, receptor_rfc: p.receptor_rfc, receptor_nombre: p.receptor_nombre,
            concepto: p.concepto, conceptos: p.conceptos, uso_cfdi: p.uso_cfdi, subtotal: p.subtotal, descuento: p.descuento, iva: p.iva, ret_isr: p.ret_isr, ret_iva: p.ret_iva, total: p.total,
            moneda: p.moneda, tc: p.tc, forma_pago: p.forma_pago, metodo_pago: p.metodo_pago, xml_documento_id: dx.id, pdf_documento_id: pdfId,
            estado: p.tipo === "nomina" || p.tipo === "emitida" ? "sin_gasto" : "nueva",
          };
          const { error: e4 } = await supabase.from("cfdi").insert(row);
          if (e4) throw e4;
          const { data: v } = await supabase.from("v_cfdi").select("*").eq("uuid", p.uuid).single();
          if (v) setCfdis((prev) => [v as Cfdi, ...prev]);
          ok++;
        } catch (e) { errs.push(`${f.name}: ${(e as Error).message}`); }
      }
      if (!xmls.length && pdfs.length) errs.push("Sube el XML junto con el PDF: el PDF solo se guarda como anexo del XML.");
      aviso(`${ok} CFDI guardado${ok === 1 ? "" : "s"}${dup ? ` · ${dup} ya existían` : ""}${errs.length ? ` · ${errs.length} con error` : ""}`);
      if (errs.length) console.warn(errs);
    } finally { setBusy(false); }
  };

  /* ---------- ligar / crear / rubro / estado ---------- */
  const refrescar = async (uuid: string) => {
    const { data: v } = await supabase.from("v_cfdi").select("*").eq("uuid", uuid).single();
    if (v) setCfdis((prev) => prev.map((c) => (c.uuid === uuid ? (v as Cfdi) : c)));
  };
  const ligar = async (c: Cfdi, g: GastoSinCfdi) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("movimientos").update({ cfdi_uuid: c.uuid, tiene_cfdi: true }).eq("id", g.id);
      if (error) throw error;
      await supabase.from("cfdi").update({ estado: "ligada", rubro_id: c.rubro_id ?? g.rubro_id }).eq("uuid", c.uuid);
      setSinCfdi((prev) => prev.filter((x) => x.id !== g.id));
      await refrescar(c.uuid); setLigando(null);
      aviso(`Ligada a ${g.rubro} ${fmt(g.monto_mxn)} del ${g.fecha}.`);
    } catch (e) { aviso("No se ligó: " + (e as Error).message); } finally { setBusy(false); }
  };
  const desligar = async (c: Cfdi) => {
    if (!c.movimiento_id) return;
    await supabase.from("movimientos").update({ cfdi_uuid: null, tiene_cfdi: false }).eq("id", c.movimiento_id);
    await supabase.from("cfdi").update({ estado: "nueva" }).eq("uuid", c.uuid);
    router.refresh(); await refrescar(c.uuid);
  };
  const crearGasto = async (c: Cfdi) => {
    const rubro = initial.rubros.find((r) => r.id === c.rubro_id);
    if (!rubro) return aviso("Elige primero el rubro de la factura.");
    const grupo = initial.rubros.find((r) => r.id === rubro.padre_id);
    const libro = ({ Akela: "AKELA", Bioongo: "BIOONGO", Periplo: "PERIPLO" } as Record<string, string>)[grupo?.nombre ?? ""] ?? "PERSONAL";
    setBusy(true);
    try {
      const p = { fecha: c.fecha, tipo: "gasto", descripcion: rubro.nombre, monto: c.total, moneda: c.moneda, cuenta_id: cCuenta, rubro_id: rubro.id, cfdi_uuid: c.uuid, notas: c.emisor_nombre, asignaciones: [{ libro, pagador: "CABZ", porcentaje: 100 }] };
      const { error } = await supabase.rpc("registrar_movimiento", { p });
      if (error) throw error;
      await supabase.from("cfdi").update({ estado: "ligada" }).eq("uuid", c.uuid);
      await refrescar(c.uuid); setCreando(null);
      aviso(`Gasto creado: ${rubro.nombre} ${fmt2(c.total)} (${initial.cuentas.find((x) => x.id === cCuenta)?.nombre}).`);
    } catch (e) { aviso("No se creó: " + (e as Error).message); } finally { setBusy(false); }
  };
  const setRubro = async (c: Cfdi, rubro_id: string) => {
    await supabase.from("cfdi").update({ rubro_id: rubro_id || null }).eq("uuid", c.uuid);
    if (c.movimiento_id && rubro_id) await supabase.from("movimientos").update({ rubro_id }).eq("id", c.movimiento_id);
    await refrescar(c.uuid);
  };
  const setEstado = async (c: Cfdi, estado: Cfdi["estado"]) => { await supabase.from("cfdi").update({ estado }).eq("uuid", c.uuid); await refrescar(c.uuid); };
  const abrir = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 300);
    if (error || !data) return aviso("No se pudo abrir el archivo.");
    window.open(data.signedUrl, "_blank");
  };
  const borrar = async (c: Cfdi) => {
    if (!confirm(`¿Borrar la factura ${c.emisor_nombre ?? c.emisor_rfc} ${fmt2(c.total)}? Se desliga del gasto (el gasto se queda).`)) return;
    if (c.movimiento_id) await supabase.from("movimientos").update({ cfdi_uuid: null, tiene_cfdi: false }).eq("id", c.movimiento_id);
    const { error } = await supabase.from("cfdi").delete().eq("uuid", c.uuid);
    if (error) return aviso("No se borró: " + error.message);
    await supabase.storage.from("documentos").remove([c.xml_path, c.pdf_path].filter(Boolean) as string[]);
    setCfdis((prev) => prev.filter((x) => x.uuid !== c.uuid)); router.refresh();
  };

  /* ---------- derivados ---------- */
  const meses = useMemo(() => [...new Set(cfdis.map((c) => mesKey(c.fecha)))].sort(), [cfdis]);
  const lista = cfdis.filter((c) => (!ftipo || c.tipo === ftipo) && (!fmes || mesKey(c.fecha) === fmes) && (!festado || c.estado === festado)
    && (!q || `${c.emisor_nombre} ${c.receptor_nombre} ${c.concepto} ${c.folio} ${c.uuid}`.toLowerCase().includes(q.toLowerCase())));
  const tot = (t: Cfdi["tipo"]) => cfdis.filter((c) => c.tipo === t).reduce((a, c) => a + c.total, 0);
  const porLigar = cfdis.filter((c) => c.estado === "nueva").length;
  const candidatos = (c: Cfdi) => {
    const d = new Date(c.fecha).getTime();
    return sinCfdi.map((g) => ({ g, dm: Math.abs(g.monto_mxn - c.total), dd: Math.abs(new Date(g.fecha).getTime() - d) / 86400000 }))
      .filter((x) => x.dm <= Math.max(2, c.total * 0.02) || (x.dd <= 10 && x.dm <= c.total * 0.25))
      .sort((a, b) => a.dm - b.dm || a.dd - b.dd).slice(0, 8).map((x) => x.g);
  };

  /* ---------- deducciones ---------- */
  const umaAnual = initial.uma * 365, tope5 = umaAnual * 5;
  const topeGeneral = Math.min(initial.ingresoAnual * 0.15, tope5);   // art. 151 último párrafo
  const topePpr = Math.min(initial.ingresoAnual * 0.10, tope5);       // art. 151 fr. V
  const ded = (k: string) => initial.deducciones.find((d) => d.categoria === k);
  const generales = ["gmm", "medico", "funeral", "colegiatura", "hipoteca", "donativo"];
  const sumGen = generales.reduce((a, k) => a + Number(ded(k)?.con_comprobante ?? 0), 0);
  const regGen = generales.reduce((a, k) => a + Number(ded(k)?.registrado ?? 0), 0);
  const pprCon = Number(ded("ppr")?.con_comprobante ?? 0);
  const deducibleGen = Math.min(sumGen, topeGeneral), deduciblePpr = Math.min(pprCon, topePpr);
  const tasa = 0.34;  // tramo marginal estimado; ajustable

  return (
    <section>
      <div className="idea"><b>Cómo funciona</b>Arrastra los XML (y sus PDF) del SAT: se guardan en tu Storage privado, se leen emisor, UUID, impuestos y total, y se ligan al gasto que ya registraste (o creas el gasto desde la factura). Abajo, lo que llevas deducible del año: PPR y seguros de gastos médicos, con sus topes.</div>

      <div className={"card" + (busy ? " spin" : "")}>
        <div className="ct"><span>Subir facturas</span><span className="tag">{initial.rfcPropio ? `tu RFC: ${initial.rfcPropio}` : "sin RFC propio: todo entra como recibida (corre 11_rfc.sql)"}</span></div>
        <label className="door" htmlFor="f-in" onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("over")}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); subir(e.dataTransfer.files); }}>
          ⬆ Suelta aquí XML y PDF de CFDI (varios a la vez) o haz clic para elegirlos
        </label>
        <input id="f-in" type="file" accept=".xml,.pdf" multiple hidden onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
        <p className="hint">El PDF se anexa si se llama igual que el XML o contiene el UUID en el nombre. Duplicados por UUID se ignoran. Nómina y emitidas quedan como «sin gasto» (son ingresos).</p>
      </div>

      <div className="g2" style={{ marginBottom: 6 }}>
        <div><label htmlFor="f-anio">Año</label><select id="f-anio" value={initial.anio} onChange={(e) => router.push(`/facturacion?anio=${e.target.value}`)}>{initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
        <div><label htmlFor="f-q">Buscar</label><input id="f-q" type="text" placeholder="emisor, concepto, folio, UUID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="stat-row">
        <div className="stat"><div className="v">{cfdis.length}</div><div className="l">CFDI {initial.anio}</div></div>
        <div className="stat"><div className="v">{fmt(tot("recibida"))}</div><div className="l">Recibidas · {cfdis.filter((c) => c.tipo === "recibida").length}</div></div>
        <div className="stat"><div className="v">{fmt(tot("emitida"))}</div><div className="l">Emitidas · {cfdis.filter((c) => c.tipo === "emitida").length}</div></div>
        <div className="stat"><div className="v">{fmt(tot("nomina"))}</div><div className="l">Nómina · {cfdis.filter((c) => c.tipo === "nomina").length}</div></div>
        <div className="stat"><div className={"v" + (porLigar ? " neg" : "")}>{porLigar}</div><div className="l">Por ligar a un gasto</div></div>
      </div>

      <div className="card">
        <div className="ct"><span>Facturas</span><span className="tag">{lista.length} de {cfdis.length}</span></div>
        <div className="g3" style={{ marginBottom: 8 }}>
          <div><label htmlFor="f-tipo">Tipo</label><select id="f-tipo" value={ftipo} onChange={(e) => setFtipo(e.target.value)}><option value="">Todas</option><option value="recibida">Recibidas</option><option value="emitida">Emitidas</option><option value="nomina">Nómina</option></select></div>
          <div><label htmlFor="f-mes">Mes</label><select id="f-mes" value={fmes} onChange={(e) => setFmes(e.target.value)}><option value="">Todos</option>{meses.map((k) => <option key={k} value={k}>{ml(k)}</option>)}</select></div>
          <div><label htmlFor="f-est">Estado</label><select id="f-est" value={festado} onChange={(e) => setFestado(e.target.value)}><option value="">Todos</option>{(Object.keys(ESTADO) as Cfdi["estado"][]).map((k) => <option key={k} value={k}>{ESTADO[k][0]}</option>)}</select></div>
        </div>
        <div className="tbl"><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Emisor / receptor</th><th>Concepto</th><th>Rubro</th><th className="n">Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map((c) => {
              const quien = c.tipo === "emitida" ? `→ ${c.receptor_nombre ?? c.receptor_rfc}` : c.emisor_nombre ?? c.emisor_rfc;
              return (
                <tr key={c.uuid}>
                  <td>{c.fecha.slice(8, 10)} {ml(c.fecha)}</td>
                  <td><span className="badge" style={{ background: TIPO_COLOR[c.tipo] }}>{TIPO_LABEL[c.tipo]}</span></td>
                  <td style={{ whiteSpace: "normal", maxWidth: 200 }}>{quien}{c.folio ? <span style={{ color: "var(--gray-soft)" }}> · {c.serie ?? ""}{c.folio}</span> : null}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 240, color: "var(--gray-soft)" }}>{c.concepto}{c.forma_pago && FORMA_PAGO[c.forma_pago] ? ` · ${FORMA_PAGO[c.forma_pago]}` : ""}</td>
                  <td>
                    {c.tipo === "recibida" ? (
                      <select value={c.rubro_id ?? ""} onChange={(e) => setRubro(c, e.target.value)} style={{ padding: "4px 6px", fontSize: 12, width: 180 }}>
                        <option value="">— rubro —</option>
                        {grupos.map((g) => <optgroup key={g.id} label={g.nombre}>{subsDe(g.id).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</optgroup>)}
                      </select>
                    ) : <span style={{ color: "var(--gray-soft)" }}>{c.tipo === "nomina" ? "Sueldo" : "Comisión"}</span>}
                  </td>
                  <td className="n" style={{ fontWeight: 700, color: "var(--ink)" }}>{c.moneda !== "MXN" ? `${c.moneda} ` : ""}{fmt2(c.total)}</td>
                  <td><span className="badge" style={{ background: ESTADO[c.estado][1] }}>{ESTADO[c.estado][0]}</span>{c.movimiento && <div style={{ fontSize: 11, color: "var(--gray-soft)", whiteSpace: "normal" }}>{c.movimiento} · {c.cuenta} · {c.movimiento_fecha?.slice(5)}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.estado !== "ligada" && c.tipo === "recibida" && <><button className="link" type="button" onClick={() => { setLigando(c); setCreando(null); }}>Ligar</button> · <button className="link" type="button" onClick={() => { setCreando(c); setLigando(null); }}>Crear gasto</button> · </>}
                    {c.estado === "ligada" && <><button className="link" type="button" onClick={() => desligar(c)}>Desligar</button> · </>}
                    {c.estado === "nueva" && <><button className="link" type="button" onClick={() => setEstado(c, "sin_gasto")}>Sin gasto</button> · </>}
                    <button className="link" type="button" onClick={() => abrir(c.xml_path)}>XML</button>{c.pdf_path && <> · <button className="link" type="button" onClick={() => abrir(c.pdf_path)}>PDF</button></>}
                    {" "}<button className="del" type="button" aria-label="Borrar" onClick={() => borrar(c)}>✕</button>
                  </td>
                </tr>
              );
            })}
            {!lista.length && <tr><td colSpan={8} className="hint">Sin facturas{cfdis.length ? " con esos filtros" : " en " + initial.anio}.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {ligando && (
        <div className="card">
          <div className="ct"><span>Ligar {ligando.emisor_nombre ?? ligando.emisor_rfc} · {fmt2(ligando.total)} · {ligando.fecha}</span><button className="btn ghost sm" type="button" onClick={() => setLigando(null)}>Cerrar</button></div>
          {candidatos(ligando).length === 0 && <p className="hint">No hay gastos sin factura con monto o fecha parecidos. Usa «Crear gasto» si no lo registraste.</p>}
          {candidatos(ligando).map((g) => (
            <div key={g.id} className="mov"><span><b style={{ color: "var(--ink)" }}>{g.grupo}</b> · {g.rubro} <span style={{ color: "var(--gray-soft)", fontSize: 12 }}>{g.fecha} · {g.cuenta}</span></span>
              <span className="r"><b style={{ color: "var(--ink)" }}>{fmt2(g.monto_mxn)}</b><button className="btn sm" type="button" onClick={() => ligar(ligando, g)} disabled={busy}>Ligar</button></span></div>
          ))}
        </div>
      )}
      {creando && (
        <div className="card">
          <div className="ct"><span>Crear gasto desde la factura · {fmt2(creando.total)} · {creando.fecha}</span><button className="btn ghost sm" type="button" onClick={() => setCreando(null)}>Cerrar</button></div>
          <div className="g3">
            <div><label>Rubro</label><div style={{ padding: "10px 0" }}>{creando.rubro ? `${creando.grupo} › ${creando.rubro}` : <span className="neg">elige el rubro en la tabla</span>}</div></div>
            <div><label htmlFor="c-cta">Pagado con</label><select id="c-cta" value={cCuenta} onChange={(e) => setCCuenta(e.target.value)}>{initial.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
            <div><label>&nbsp;</label><button className="btn sm" type="button" onClick={() => crearGasto(creando)} disabled={busy || !creando.rubro_id}>+ Crear y ligar</button></div>
          </div>
          <p className="hint">Se registra como gasto real en la fecha de la factura, al libro que corresponde al rubro, pagado por ti.</p>
        </div>
      )}

      <h2>Deducciones personales · {initial.anio}</h2>
      <div className="g2">
        <div className="card">
          <div className="ct"><span>Gastos médicos y seguros</span><span className="tag">tope: 15 % del ingreso o 5 UMA anuales, lo menor</span></div>
          <div className="tbl"><table>
            <thead><tr><th>Concepto</th><th className="n">Registrado</th><th className="n">Con CFDI</th><th className="n">Sin CFDI</th></tr></thead>
            <tbody>
              {generales.filter((k) => ded(k)).map((k) => { const d = ded(k)!; return (
                <tr key={k}><td style={{ whiteSpace: "normal" }}>{DED_LABEL[k]}</td><td className="n">{fmt(Number(d.registrado))}</td><td className="n pos">{fmt(Number(d.con_comprobante ?? 0))}</td><td className={"n" + (d.sin_cfdi ? " neg" : "")}>{d.sin_cfdi} mov.</td></tr>); })}
              {!generales.some((k) => ded(k)) && <tr><td colSpan={4} className="hint">Sin gastos en rubros deducibles este año.</td></tr>}
              <tr className="tot"><td>Deducible (con CFDI)</td><td className="n">{fmt(regGen)}</td><td className="n">{fmt(deducibleGen)}</td><td className="n">{sumGen > topeGeneral ? "al tope" : ""}</td></tr>
            </tbody>
          </table></div>
          <p className="hint">Tope general {fmt(topeGeneral)} (ingreso del año {fmt(initial.ingresoAnual)} × 15 % vs 5 UMA = {fmt(tope5)}). Requiere CFDI a tu nombre y pago con tarjeta, cheque o transferencia. Ahorro fiscal estimado ≈ {fmt(deducibleGen * tasa)} al {Math.round(tasa * 100)} % marginal.</p>
        </div>
        <div className="card">
          <div className="ct"><span>PPR / AFORE voluntaria</span><span className="tag">art. 151 fr. V · tope aparte</span></div>
          <div className="stat-row">
            <div className="stat"><div className="v">{fmt(Number(ded("ppr")?.registrado ?? 0))}</div><div className="l">Aportado {initial.anio}</div></div>
            <div className="stat"><div className="v">{fmt(topePpr)}</div><div className="l">Tope (10 % ingreso o 5 UMA)</div></div>
            <div className="stat"><div className={"v " + (deduciblePpr >= topePpr ? "pos" : "")}>{fmt(deduciblePpr)}</div><div className="l">Deducible</div></div>
          </div>
          <div className="catbar"><div className="lbl"><span>Avance al tope</span><span>{topePpr ? Math.round((deduciblePpr / topePpr) * 100) : 0} %</span></div><div className="track"><div className="fill" style={{ width: `${topePpr ? Math.min(100, (deduciblePpr / topePpr) * 100) : 0}%`, background: "var(--aho)" }} /></div></div>
          <p className="hint">Faltan {fmt(Math.max(0, topePpr - pprCon))} para llegar al tope este año; ahorro fiscal estimado ≈ {fmt(deduciblePpr * tasa)}. Se acredita con la constancia anual de la aseguradora/operadora, no con CFDI. Registra las aportaciones en Gastos → Ahorro › PPR.</p>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
