"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Cfdi, FacturacionData } from "@/lib/types";
import { fmt, fmt2, mesKey, ml } from "@/lib/format";
import { parseCfdi, FORMA_PAGO } from "@/lib/cfdi";

const TIPO_LABEL = { emitida: "Emitida", recibida: "Recibida", nomina: "Nómina" } as const;
const TIPO_COLOR = { emitida: "var(--c6)", recibida: "var(--aho)", nomina: "var(--nec)" } as const;
const ESTADO = { nueva: ["Nueva", "var(--gus)"], ligada: ["Ligada", "var(--nec)"], revisar: ["Revisar", "var(--deu)"], sin_gasto: ["Sin gasto", "var(--gray-soft)"] } as const;
const DED_LABEL: Record<string, string> = { gmm: "Primas de gastos médicos mayores", medico: "Honorarios médicos, dentales y hospital", ppr: "Aportaciones a PPR / AFORE voluntaria", funeral: "Gastos funerarios", colegiatura: "Colegiaturas", hipoteca: "Intereses hipotecarios", donativo: "Donativos" };

export function Facturacion({ initial, vista = "resumen" }: { initial: FacturacionData; vista?: "resumen" | "detalle" }) {
  const base = vista === "detalle" ? "/facturacion/detalle" : "/facturacion";
  const router = useRouter();
  const supabase = createClient();
  const [cfdis, setCfdis] = useState<Cfdi[]>(initial.cfdis);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [ftipo, setFtipo] = useState(""); const [fmes, setFmes] = useState(""); const [festado, setFestado] = useState(""); const [q, setQ] = useState("");
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

  const sincronizar = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/drive/sync", { method: "POST" }); const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      aviso(`Drive: ${j.cfdi} CFDI, ${j.pdf} PDF anexos, ${j.extranjeras} extranjeras, ${j.duplicados} repetidas, ${j.errores} errores${j.pendientes ? ` · faltan ${j.pendientes}, vuelve a pulsar` : ""}.`);
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) { aviso("Drive: " + (e as Error).message); } finally { setBusy(false); }
  };

  /* ---------- crear / rubro / estado ---------- */
  const refrescar = async (uuid: string) => {
    const { data: v } = await supabase.from("v_cfdi").select("*").eq("uuid", uuid).single();
    if (v) setCfdis((prev) => prev.map((c) => (c.uuid === uuid ? (v as Cfdi) : c)));
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
  const esSinRubro = (c: Cfdi) => c.tipo === "recibida" && !c.rubro_id;
  const sinRubro = cfdis.filter(esSinRubro).length;
  const sinRubroMes = (mes: string) => cfdis.filter((c) => esSinRubro(c) && c.fecha.startsWith(mes)).length;

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

  /* ---------- resumen mensual ---------- */
  const mesesRes = [...new Set(initial.mensual.map((m) => m.mes.slice(0, 7)))].sort();
  const cel = (mes: string, tipo: string, k: "facturas" | "total_mxn" | "iva" | "ret_isr" | "ret_iva" | "por_ligar") => initial.mensual.filter((m) => m.mes.startsWith(mes) && (tipo === "*" || m.tipo === tipo)).reduce((a, m) => a + Number(m[k]), 0);

  /* ---------- exportar detalle (mismas columnas que Panel_Facturas_Maestro) ---------- */
  const COLS: [string, (c: Cfdi) => string | number | null][] = [
    ["ID", (c) => c.num], ["Tipo", (c) => TIPO_LABEL[c.tipo]], ["Fecha emisión", (c) => c.fecha], ["Folio Fiscal (UUID)", (c) => c.uuid.toUpperCase()], ["Serie", (c) => c.serie], ["Folio", (c) => c.folio],
    ["Emisor", (c) => c.emisor_nombre], ["RFC emisor", (c) => c.emisor_rfc], ["Receptor", (c) => c.receptor_nombre], ["RFC receptor", (c) => c.receptor_rfc], ["Concepto", (c) => c.concepto],
    ["Categoría contable", (c) => c.rubro ? `${c.grupo} › ${c.rubro}` : c.tipo === "nomina" ? "Sueldo" : c.tipo === "emitida" ? "Comisión" : null], ["Uso CFDI", (c) => c.uso_cfdi],
    ["Subtotal", (c) => c.subtotal], ["IVA", (c) => c.iva], ["Ret. ISR", (c) => c.ret_isr], ["Ret. IVA", (c) => c.ret_iva], ["Total", (c) => c.total], ["Moneda", (c) => c.moneda], ["Tipo de cambio", (c) => c.tc], ["Total en MXN", (c) => c.total_mxn],
    ["Forma de pago", (c) => c.forma_pago ? `${c.forma_pago} ${FORMA_PAGO[c.forma_pago] ?? ""}`.trim() : null], ["Método de pago", (c) => c.metodo_pago], ["Vencimiento", (c) => c.vencimiento],
    ["Archivo origen", (c) => c.xml_nombre], ["Link Drive", (c) => c.link_drive], ["Confianza", (c) => c.confianza ?? (c.xml_path ? "alta (XML)" : null)], ["Notas", (c) => c.notas],
  ];
  const exportar = () => {
    const esc = (v: string | number | null) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = [COLS.map((c) => c[0]).join(","), ...lista.map((c) => COLS.map(([, f]) => esc(f(c))).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); a.download = `facturas_${initial.anio}.csv`; a.click();
  };
  const editar = async (c: Cfdi, campo: "vencimiento" | "notas" | "link_drive", valor: string) => {
    await supabase.from("cfdi").update({ [campo]: valor || null }).eq("uuid", c.uuid); await refrescar(c.uuid);
  };

  return (
    <section>
      <div className="idea"><b>Cómo funciona</b>Sube tus facturas a la carpeta de Drive «01 - Facturas» (o suéltalas aquí): se guardan en tu Storage privado y se leen emisor, UUID, impuestos y total. Ponle rubro a una factura y todas las de ese emisor lo heredan. Abajo, lo que llevas deducible del año: PPR y seguros de gastos médicos, con sus topes.</div>

      {vista === "resumen" && (<>
      <div className={"card" + (busy ? " spin" : "")}>
        <div className="ct"><span>Facturas desde Drive</span><span className="tag">{initial.rfcPropio ? `tu RFC: ${initial.rfcPropio}` : "sin RFC propio: todo entra como recibida (corre 11_rfc.sql)"}</span></div>
        <div className="g2">
          <div>
            {initial.drive
              ? <><button className="btn sm" type="button" onClick={sincronizar} disabled={busy}>⟳ Traer de Drive ahora</button>
                  <p className="hint">Se revisa sola una vez al día; aquí la fuerzas. Última: {initial.ultimaSync ? new Date(initial.ultimaSync).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }) : "nunca"}.</p></>
              : <p className="hint">Para que lea tu carpeta «01 - Facturas» sola: pon GOOGLE_SERVICE_ACCOUNT_JSON y DRIVE_FACTURAS_FOLDER_ID en Vercel (instrucciones en el chat).</p>}
          </div>
          <div>
        <label className="door" htmlFor="f-in" onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }} onDragLeave={(e) => e.currentTarget.classList.remove("over")}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); subir(e.dataTransfer.files); }}>
          ⬆ O suelta aquí XML y PDF (varios a la vez)
        </label>
        <input id="f-in" type="file" accept=".xml,.pdf" multiple hidden onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
          </div>
        </div>
        <p className="hint">Mexicanas = XML CFDI (el PDF se anexa si se llama igual o trae el UUID). PDF sin XML = extranjera, catalogada por la carpeta de mes. Duplicados por UUID se ignoran; nómina y emitidas quedan «sin gasto».</p>
      </div>

      <div className="g2" style={{ marginBottom: 6 }}>
        <div><label htmlFor="f-anio">Año</label><select id="f-anio" value={initial.anio} onChange={(e) => router.push(`${base}?anio=${e.target.value}`)}>{initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
        <div><label htmlFor="f-q">Buscar</label><input id="f-q" type="text" placeholder="emisor, concepto, folio, UUID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="stat-row">
        <div className="stat"><div className="v">{cfdis.length}</div><div className="l">CFDI {initial.anio}</div></div>
        <div className="stat"><div className="v">{fmt(tot("recibida"))}</div><div className="l">Recibidas · {cfdis.filter((c) => c.tipo === "recibida").length}</div></div>
        <div className="stat"><div className="v">{fmt(tot("emitida"))}</div><div className="l">Emitidas · {cfdis.filter((c) => c.tipo === "emitida").length}</div></div>
        <div className="stat"><div className="v">{fmt(tot("nomina"))}</div><div className="l">Nómina · {cfdis.filter((c) => c.tipo === "nomina").length}</div></div>
        <div className="stat"><div className={"v" + (sinRubro ? " neg" : "")}>{sinRubro}</div><div className="l">Recibidas sin rubro</div></div>
      </div>

      <div className="card">
        <div className="ct"><span>Resumen mensual · {initial.anio}</span><Link href={`/facturacion/detalle?anio=${initial.anio}`} className="btn ghost sm">Ver detalle (todas las columnas) →</Link></div>
        <div className="tbl"><table>
          <thead><tr><th>Mes</th><th className="n">Recibidas</th><th className="n">Total recibidas</th><th className="n">IVA acreditable</th><th className="n">Emitidas</th><th className="n">Total emitidas</th><th className="n">Ret. ISR</th><th className="n">Ret. IVA</th><th className="n">Nómina</th><th className="n">Sin rubro</th></tr></thead>
          <tbody>
            {mesesRes.map((m) => (
              <tr key={m}><td>{ml(m)}</td>
                <td className="n">{cel(m, "recibida", "facturas") || "·"}</td><td className="n">{fmt(cel(m, "recibida", "total_mxn"))}</td><td className="n">{fmt(cel(m, "recibida", "iva"))}</td>
                <td className="n">{cel(m, "emitida", "facturas") || "·"}</td><td className="n">{fmt(cel(m, "emitida", "total_mxn"))}</td><td className="n">{fmt(cel(m, "emitida", "ret_isr"))}</td><td className="n">{fmt(cel(m, "emitida", "ret_iva"))}</td>
                <td className="n">{fmt(cel(m, "nomina", "total_mxn"))}</td>
                <td className={"n" + (sinRubroMes(m) ? " neg" : "")}>{sinRubroMes(m) || "·"}</td></tr>
            ))}
            {!mesesRes.length && <tr><td colSpan={10} className="hint">Sin facturas en {initial.anio}. Sube los XML arriba.</td></tr>}
            {mesesRes.length > 0 && <tr className="tot"><td>Año</td>
              <td className="n">{cel("", "recibida", "facturas")}</td><td className="n">{fmt(cel("", "recibida", "total_mxn"))}</td><td className="n">{fmt(cel("", "recibida", "iva"))}</td>
              <td className="n">{cel("", "emitida", "facturas")}</td><td className="n">{fmt(cel("", "emitida", "total_mxn"))}</td><td className="n">{fmt(cel("", "emitida", "ret_isr"))}</td><td className="n">{fmt(cel("", "emitida", "ret_iva"))}</td>
              <td className="n">{fmt(cel("", "nomina", "total_mxn"))}</td><td className="n">{sinRubro}</td></tr>}
          </tbody>
        </table></div>
        <p className="hint">Totales en MXN al tipo de cambio de la factura. IVA acreditable y retenciones son lo que tu contador necesita cada mes.</p>
      </div>
      {initial.extranjeras.length > 0 && (
        <div className="card">
          <div className="ct"><span>Facturas extranjeras · {initial.anio}</span><span className="tag">{initial.extranjeras.length} PDF sin CFDI, por mes</span></div>
          <div className="tbl"><table>
            <thead><tr><th>Mes</th><th>Archivo</th><th>Carpeta en Drive</th><th></th></tr></thead>
            <tbody>{initial.extranjeras.map((x) => (
              <tr key={x.drive_id}><td>{x.mes ? ml(x.mes) : "—"}</td><td style={{ whiteSpace: "normal" }}>{x.nombre}</td><td style={{ color: "var(--gray-soft)" }}>{x.carpeta}</td>
                <td>{x.storage_path && <button className="link" type="button" onClick={() => abrir(x.storage_path)}>PDF</button>}{x.link_drive && <> · <a className="link" href={x.link_drive} target="_blank" rel="noreferrer">Drive</a></>}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="hint">Monto y proveedor de extranjeras se capturarán con lectura por IA del PDF en una sesión posterior.</p>
        </div>
      )}

      <h2>Deducciones personales · {initial.anio}</h2>
      <div className="g2">
        <div className="card">
          <div className="ct"><span>Gastos médicos y seguros</span><span className="tag">tope: 15 % del ingreso o 5 UMA anuales, lo menor</span></div>
          <div className="tbl"><table>
            <thead><tr><th>Concepto</th><th className="n">Gastado</th><th className="n">Facturado (CFDI)</th><th className="n">Facturas</th></tr></thead>
            <tbody>
              {generales.filter((k) => ded(k)).map((k) => { const d = ded(k)!; return (
                <tr key={k}><td style={{ whiteSpace: "normal" }}>{DED_LABEL[k]}</td><td className="n">{fmt(Number(d.registrado))}</td><td className="n pos">{fmt(Number(d.con_comprobante ?? 0))}</td><td className="n">{d.facturas}</td></tr>); })}
              {!generales.some((k) => ded(k)) && <tr><td colSpan={4} className="hint">Sin gastos en rubros deducibles este año.</td></tr>}
              <tr className="tot"><td>Deducible</td><td className="n">{fmt(regGen)}</td><td className="n">{fmt(deducibleGen)}</td><td className="n">{sumGen > topeGeneral ? "al tope" : ""}</td></tr>
            </tbody>
          </table></div>
          <p className="hint">Tope general {fmt(topeGeneral)} (ingreso del año {fmt(initial.ingresoAnual)} × 15 % vs 5 UMA = {fmt(tope5)}). Cuenta lo facturado a tu RFC en rubros deducibles (asigna el rubro a la factura una vez; el emisor se recuerda). Ahorro fiscal estimado ≈ {fmt(deducibleGen * tasa)} al {Math.round(tasa * 100)} % marginal.</p>
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

      </>)}
      {vista === "detalle" && (<>
        <div className="topline" style={{ marginBottom: 8 }}><Link href={`/facturacion?anio=${initial.anio}`} className="btn ghost sm">← Resumen</Link></div>
      <div className="g2" style={{ marginBottom: 6 }}>
        <div><label htmlFor="f-anio">Año</label><select id="f-anio" value={initial.anio} onChange={(e) => router.push(`${base}?anio=${e.target.value}`)}>{initial.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
        <div><label htmlFor="f-q">Buscar</label><input id="f-q" type="text" placeholder="emisor, concepto, folio, UUID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="stat-row">
        <div className="stat"><div className="v">{cfdis.length}</div><div className="l">CFDI {initial.anio}</div></div>
        <div className="stat"><div className="v">{fmt(tot("recibida"))}</div><div className="l">Recibidas · {cfdis.filter((c) => c.tipo === "recibida").length}</div></div>
        <div className="stat"><div className="v">{fmt(tot("emitida"))}</div><div className="l">Emitidas · {cfdis.filter((c) => c.tipo === "emitida").length}</div></div>
        <div className="stat"><div className="v">{fmt(tot("nomina"))}</div><div className="l">Nómina · {cfdis.filter((c) => c.tipo === "nomina").length}</div></div>
        <div className="stat"><div className={"v" + (sinRubro ? " neg" : "")}>{sinRubro}</div><div className="l">Recibidas sin rubro</div></div>
      </div>

      <div className="card">
        <div className="ct"><span>Detalle de facturas</span><span className="tag">{lista.length} de {cfdis.length} · <button className="link" type="button" onClick={exportar}>exportar CSV</button></span></div>
        <div className="g3" style={{ marginBottom: 8 }}>
          <div><label htmlFor="f-tipo">Tipo</label><select id="f-tipo" value={ftipo} onChange={(e) => setFtipo(e.target.value)}><option value="">Todas</option><option value="recibida">Recibidas</option><option value="emitida">Emitidas</option><option value="nomina">Nómina</option></select></div>
          <div><label htmlFor="f-mes">Mes</label><select id="f-mes" value={fmes} onChange={(e) => setFmes(e.target.value)}><option value="">Todos</option>{meses.map((k) => <option key={k} value={k}>{ml(k)}</option>)}</select></div>
          <div><label htmlFor="f-est">Estado</label><select id="f-est" value={festado} onChange={(e) => setFestado(e.target.value)}><option value="">Todos</option>{(Object.keys(ESTADO) as Cfdi["estado"][]).map((k) => <option key={k} value={k}>{ESTADO[k][0]}</option>)}</select></div>
        </div>
        <div className="tbl" style={{ fontSize: 12 }}><table>
          <thead><tr>{COLS.map((c) => <th key={c[0]} className={["Subtotal", "IVA", "Ret. ISR", "Ret. IVA", "Total", "Total en MXN", "Tipo de cambio"].includes(c[0]) ? "n" : undefined}>{c[0]}</th>)}<th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.uuid}>
                <td>{c.num}</td>
                <td><span className="badge" style={{ background: TIPO_COLOR[c.tipo] }}>{TIPO_LABEL[c.tipo]}</span></td>
                <td>{c.fecha}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }} title={c.uuid}>{c.uuid.slice(0, 8).toUpperCase()}…</td>
                <td>{c.serie}</td><td>{c.folio}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 180 }}>{c.emisor_nombre}</td><td>{c.emisor_rfc}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 160 }}>{c.receptor_nombre}</td><td>{c.receptor_rfc}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 220 }}>{c.concepto}</td>
                <td>{c.tipo === "recibida" ? (
                  <select value={c.rubro_id ?? ""} onChange={(e) => setRubro(c, e.target.value)} style={{ padding: "3px 5px", fontSize: 12, width: 170 }}>
                    <option value="">— rubro —</option>
                    {grupos.map((g) => <optgroup key={g.id} label={g.nombre}>{subsDe(g.id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</optgroup>)}
                  </select>) : c.tipo === "nomina" ? "Sueldo" : "Comisión"}</td>
                <td>{c.uso_cfdi}</td>
                <td className="n">{fmt2(c.subtotal)}</td><td className="n">{fmt2(c.iva)}</td><td className="n">{fmt2(c.ret_isr)}</td><td className="n">{fmt2(c.ret_iva)}</td>
                <td className="n" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmt2(c.total)}</td><td>{c.moneda}</td><td className="n">{c.tc ?? ""}</td><td className="n">{fmt2(c.total_mxn)}</td>
                <td>{c.forma_pago ? FORMA_PAGO[c.forma_pago] ?? c.forma_pago : ""}</td><td>{c.metodo_pago}</td>
                <td><input type="date" defaultValue={c.vencimiento ?? ""} onBlur={(e) => e.target.value !== (c.vencimiento ?? "") && editar(c, "vencimiento", e.target.value)} style={{ padding: "3px 5px", fontSize: 12, width: 130 }} /></td>
                <td style={{ whiteSpace: "normal", maxWidth: 160, fontSize: 11 }}>{c.xml_nombre}{c.pdf_nombre ? ` · ${c.pdf_nombre}` : ""}</td>
                <td><input type="url" defaultValue={c.link_drive ?? ""} placeholder="https://drive…" onBlur={(e) => e.target.value !== (c.link_drive ?? "") && editar(c, "link_drive", e.target.value)} style={{ padding: "3px 5px", fontSize: 12, width: 120 }} /></td>
                <td>{c.confianza ?? (c.xml_path ? "alta (XML)" : "")}</td>
                <td><input type="text" defaultValue={c.notas ?? ""} onBlur={(e) => e.target.value !== (c.notas ?? "") && editar(c, "notas", e.target.value)} style={{ padding: "3px 5px", fontSize: 12, width: 140 }} /></td>
                <td><span className="badge" style={{ background: ESTADO[c.estado][1] }}>{ESTADO[c.estado][0]}</span>{c.movimiento && <div style={{ fontSize: 11, color: "var(--gray-soft)", whiteSpace: "normal" }}>{c.movimiento} · {c.cuenta}</div>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {c.estado !== "ligada" && c.tipo === "recibida" && <><button className="link" type="button" onClick={() => setCreando(c)}>Crear gasto</button> · </>}
                  {c.estado === "ligada" && <><button className="link" type="button" onClick={() => desligar(c)}>Desligar</button> · </>}
                  {c.estado === "nueva" && <><button className="link" type="button" onClick={() => setEstado(c, "sin_gasto")}>Sin gasto</button> · </>}
                  <button className="link" type="button" onClick={() => abrir(c.xml_path)}>XML</button>{c.pdf_path && <> · <button className="link" type="button" onClick={() => abrir(c.pdf_path)}>PDF</button></>}
                  {" "}<button className="del" type="button" aria-label="Borrar" onClick={() => borrar(c)}>✕</button>
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={30} className="hint">Sin facturas{cfdis.length ? " con esos filtros" : " en " + initial.anio}.</td></tr>}
          </tbody>
        </table></div>
        <p className="hint">Vencimiento, link de Drive y notas se editan en la celda (se guardan al salir). Confianza «alta (XML)» = leída del XML timbrado.</p>
      </div>
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

      </>)}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
