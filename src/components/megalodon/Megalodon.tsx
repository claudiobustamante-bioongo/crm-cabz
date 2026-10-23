"use client";
import { Fragment, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TablaFija } from "@/components/TablaFija";

export interface MegSeccion { id: string; orden: number; clave: string; titulo: string; contenido: string; updated_at: string }
export interface MegActivo { id: string; orden: number; categoria: string; nombre: string; institucion: string | null; numero: string | null; usuario: string | null; titular: string | null; beneficiarios: string | null; que_hacer: string | null; destino: string | null; contacto: string | null; liga: string | null; documento_path: string | null; notas: string | null; ultima_revision: string | null; updated_at: string;
  cuenta_id?: string | null; seccion_clave?: string | null; suma_asegurada?: string | null; prima?: string | null; vigencia_inicio?: string | null; vigencia_fin?: string | null; cobertura?: string | null }
export interface MegCuenta { id: string; nombre: string; tipo: string; moneda: string; saldo: number; saldo_mxn: number; fecha: string | null }
export interface MegalodonData { secciones: MegSeccion[]; activos: MegActivo[]; cuentas: MegCuenta[]; userId: string; listo: boolean; conSaldos: boolean }

const CAT: Record<string, string> = { cuenta: "Cuentas e inversiones", seguro: "Seguros", propiedad: "Propiedades", empresa: "Empresas y participaciones", contacto: "Contactos clave", documento: "Documentos", otro: "Otros" };
const CAT_ORDEN = ["cuenta", "seguro", "propiedad", "empresa", "contacto", "documento", "otro"];
const CAMPOS: { k: keyof MegActivo; l: string; w?: number; multi?: boolean }[] = [
  { k: "institucion", l: "Institución" }, { k: "numero", l: "Número / contrato / póliza" }, { k: "usuario", l: "Usuario de acceso" }, { k: "titular", l: "Titular" },
  { k: "beneficiarios", l: "Beneficiarios" }, { k: "destino", l: "A quién va / a dónde se mueve" }, { k: "contacto", l: "Contacto" }, { k: "liga", l: "Liga (Drive, portal)" },
  { k: "suma_asegurada", l: "Suma asegurada / cobertura" }, { k: "prima", l: "Prima" }, { k: "cobertura", l: "Condiciones clave", multi: true },
  { k: "que_hacer", l: "Qué hacer", multi: true }, { k: "notas", l: "Notas", multi: true },
];
const fmtMx = (n: number) => "$" + Math.round(n).toLocaleString("es-MX");
const linkify = (t: string) => t.split(/(https?:\/\/\S+)/g).map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : <Fragment key={i}>{p}</Fragment>);

export function Megalodon({ initial }: { initial: MegalodonData }) {
  const supabase = createClient();
  const [secs, setSecs] = useState(initial.secciones);
  const [acts, setActs] = useState(initial.activos);
  const [edit, setEdit] = useState<string | null>(null);        // id de sección o activo en edición
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState("");
  const aviso = (t: string) => { setToast(t); setTimeout(() => setToast(""), 4000); };
  const ultima = [...secs.map((s) => s.updated_at), ...acts.map((a) => a.updated_at)].sort().pop()?.slice(0, 10) ?? "—";

  /* ---------- secciones ---------- */
  const guardarSec = async (s: MegSeccion, patch: Partial<MegSeccion>) => {
    const { error } = await supabase.from("megalodon_secciones").update(patch).eq("id", s.id);
    if (error) return aviso("No se guardó: " + error.message);
    setSecs((p) => p.map((x) => x.id === s.id ? { ...x, ...patch, updated_at: new Date().toISOString() } : x));
  };
  const nuevaSec = async () => {
    const titulo = prompt("Título de la nueva sección:"); if (!titulo) return;
    const clave = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) + "_" + Date.now().toString(36);
    const { data, error } = await supabase.from("megalodon_secciones").insert({ orden: (secs[secs.length - 1]?.orden ?? 0) + 1, clave, titulo, contenido: "" }).select("*").single();
    if (error) return aviso(error.message); setSecs((p) => [...p, data as MegSeccion]); setEdit(data.id);
  };
  const borrarSec = async (s: MegSeccion) => { if (!confirm(`¿Borrar la sección «${s.titulo}»?`)) return; const { error } = await supabase.from("megalodon_secciones").delete().eq("id", s.id); if (error) return aviso(error.message); setSecs((p) => p.filter((x) => x.id !== s.id)); };

  /* ---------- activos ---------- */
  const guardarAct = async (a: MegActivo, patch: Partial<MegActivo>) => {
    const { error } = await supabase.from("megalodon_activos").update(patch).eq("id", a.id);
    if (error) return aviso("No se guardó: " + error.message);
    setActs((p) => p.map((x) => x.id === a.id ? { ...x, ...patch, updated_at: new Date().toISOString() } : x));
  };
  const nuevoAct = async (categoria: string) => {
    const nombre = prompt(`Nombre del nuevo elemento en «${CAT[categoria]}»:`); if (!nombre) return;
    const { data, error } = await supabase.from("megalodon_activos").insert({ categoria, nombre, orden: acts.filter((x) => x.categoria === categoria).length + 1 }).select("*").single();
    if (error) return aviso(error.message); setActs((p) => [...p, data as MegActivo]); setEdit(data.id);
  };
  const borrarAct = async (a: MegActivo) => {
    if (!confirm(`¿Borrar «${a.nombre}»?`)) return;
    if (a.documento_path) await supabase.storage.from("documentos").remove([a.documento_path]);
    const { error } = await supabase.from("megalodon_activos").delete().eq("id", a.id); if (error) return aviso(error.message); setActs((p) => p.filter((x) => x.id !== a.id));
  };
  const revisado = async (a: MegActivo) => guardarAct(a, { ultima_revision: new Date().toISOString().slice(0, 10) });
  const subir = async (a: MegActivo, f: File) => {
    setBusy(true);
    const path = `${initial.userId}/megalodon/${a.id}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await supabase.storage.from("documentos").upload(path, f, { upsert: true, contentType: f.type || undefined });
    setBusy(false);
    if (error) return aviso("No se subió: " + error.message);
    if (a.documento_path && a.documento_path !== path) await supabase.storage.from("documentos").remove([a.documento_path]);
    await guardarAct(a, { documento_path: path }); aviso(`${f.name} guardado aquí (ya no depende de Drive).`);
  };
  const abrir = async (path: string) => { const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 300); if (error || !data) return aviso("No se pudo abrir."); window.open(data.signedUrl, "_blank"); };
  const quitarDoc = async (a: MegActivo) => { if (!a.documento_path || !confirm("¿Quitar el archivo adjunto?")) return; await supabase.storage.from("documentos").remove([a.documento_path]); await guardarAct(a, { documento_path: null }); };

  const vis = acts.filter((a) => !filtro || JSON.stringify(a).toLowerCase().includes(filtro.toLowerCase()));
  const cta = (a: MegActivo) => initial.cuentas.find((c) => c.id === a.cuenta_id) ?? null;
  const saldoTxt = (a: MegActivo) => { const c = cta(a); if (!c) return null; return (c.moneda === "USD" ? `US$${Math.round(c.saldo).toLocaleString("en-US")} ≈ ` : "") + fmtMx(c.saldo_mxn) + (c.fecha ? ` (${c.fecha})` : ""); };
  const ir = (id: string) => { const el = document.getElementById(id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); } };
  const secDe = (a: MegActivo) => secs.find((x) => x.clave === a.seccion_clave) ?? null;
  const hoyS = new Date().toISOString().slice(0, 10);
  const vig = (a: MegActivo) => !a.vigencia_fin ? null : a.vigencia_fin < hoyS ? "vencida" : a.vigencia_fin < new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10) ? "vence pronto" : "vigente";
  const totalCuentas = acts.reduce((t, a) => t + (cta(a)?.saldo_mxn ?? 0), 0);
  const pendientes = acts.filter((a) => /completar|capturar/i.test([a.institucion, a.numero, a.beneficiarios, a.contacto, a.notas, a.titular].join(" ")));

  if (!initial.listo) return <section><div className="idea"><b>Megalodón</b> Falta crear las tablas: corre <code>39_megalodon.sql</code> en Supabase y recarga.</div></section>;

  return (
    <section className="megalodon">
      <div className="idea"><b>Megalodón</b> Protocolo en caso de mi fallecimiento: qué hacer, en qué orden, y dónde está cada cosa para recuperar todos los activos. Para Sofía, Luciano y el albacea. <span className="hint">Última actualización {ultima}. Las contraseñas no se guardan aquí: solo dónde están.</span></div>

      <div className="card no-print">
        <div className="ct"><span>Estado</span><span style={{ display: "flex", gap: 8 }}><input type="search" placeholder="buscar en el inventario…" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 220 }} /><button className="btn ghost sm" type="button" onClick={() => window.print()}>🖨 Imprimir / PDF</button></span></div>
        <div className="stat-row">
          <div className="stat"><div className="v">{acts.length}</div><div className="l">elementos en el inventario</div></div>
          <div className="stat"><div className={"v " + (pendientes.length ? "neg" : "pos")}>{pendientes.length}</div><div className="l">con datos por completar</div></div>
          <div className="stat"><div className="v">{acts.filter((a) => a.documento_path).length}</div><div className="l">documentos guardados aquí · {acts.filter((a) => a.liga && !a.documento_path).length} solo en Drive</div></div>
          <div className="stat"><div className="v">{acts.filter((a) => a.ultima_revision && a.ultima_revision < new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)).length}</div><div className="l">sin revisar hace más de un año</div></div>
        </div>
        {pendientes.length > 0 && <p className="hint">Por completar: {pendientes.map((a) => a.nombre).join(" · ")}.</p>}
      </div>

      {/* ---------- consolidado ---------- */}
      <div className="card">
        <div className="ct"><span>Consolidado · dónde está todo</span><span className="tag">toca un renglón para ir a su ficha · «instrucción» abre el paso a paso</span></div>
        <TablaFija grupo="meg" alto="60vh"><table style={{ fontSize: 12.5 }}>
          <thead><tr><th>Elemento</th><th>Institución</th><th>Número / póliza</th><th className="n">Saldo o suma asegurada</th><th>Vigencia / beneficiarios</th><th>A quién va</th><th className="no-print">Instrucción</th></tr></thead>
          <tbody>
            {CAT_ORDEN.filter((c) => c !== "contacto" && acts.some((a) => a.categoria === c)).map((c) => (
              <Fragment key={c}>
                <tr className="sec"><td colSpan={7}>{CAT[c]}{c === "cuenta" && totalCuentas ? <> · saldos ligados <b style={{ fontSize: 15, color: "var(--ink)" }}>{fmtMx(totalCuentas)}</b></> : null}</td></tr>
                {acts.filter((a) => a.categoria === c).sort((a, b) => a.orden - b.orden).map((a) => { const v = vig(a); const sec = secDe(a); return (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => ir("act-" + a.id)}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}>{a.nombre}{a.documento_path ? <span className="badge" style={{ marginLeft: 6 }}>doc</span> : null}</td>
                    <td className="hint">{a.institucion ?? "·"}</td><td>{a.numero ?? "·"}</td>
                    <td className="n" style={{ whiteSpace: "normal", maxWidth: 260 }}>{saldoTxt(a) ? <b style={{ color: "var(--ink)", fontSize: 13.5 }}>{saldoTxt(a)}</b> : a.suma_asegurada ?? "·"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{a.vigencia_fin ? <span className={v === "vencida" ? "neg" : v === "vence pronto" ? "" : "pos"} title={`${a.vigencia_inicio ?? ""} → ${a.vigencia_fin}`}>{v} · hasta {a.vigencia_fin}</span> : null}{a.vigencia_fin && a.beneficiarios ? " · " : ""}{a.beneficiarios ?? ""}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 220 }}>{a.destino ?? "·"}</td>
                    <td className="no-print">{sec ? <button className="link" type="button" onClick={(e) => { e.stopPropagation(); ir("sec-" + sec.id); }}>{sec.titulo.slice(0, 28)}{sec.titulo.length > 28 ? "…" : ""}</button> : <span className="hint">·</span>}</td>
                  </tr>); })}
              </Fragment>))}
          </tbody>
        </table></TablaFija>
        {!initial.conSaldos && <p className="hint">Para ver saldos en vivo y datos de pólizas corre <code>40_megalodon_saldos.sql</code> (y tu 40b).</p>}
      </div>

      {/* ---------- secciones de texto ---------- */}
      {secs.sort((a, b) => a.orden - b.orden).map((s, i) => (
        <Fragment key={s.id}>
          <h2>{i + 1} · {edit === s.id ? <input type="text" defaultValue={s.titulo} onBlur={(e) => e.target.value.trim() && e.target.value !== s.titulo && guardarSec(s, { titulo: e.target.value.trim() })} style={{ fontSize: "inherit", fontFamily: "inherit", width: "60%" }} /> : s.titulo}
            <span className="no-print" style={{ fontSize: 12, fontWeight: 400, marginLeft: 10 }}><button className="link" type="button" onClick={() => setEdit(edit === s.id ? null : s.id)}>{edit === s.id ? "listo" : "editar"}</button> {edit === s.id && <button className="del" type="button" onClick={() => borrarSec(s)}>✕</button>}</span></h2>
          <div className="card" id={"sec-" + s.id}>
            {edit === s.id
              ? <textarea defaultValue={s.contenido} rows={Math.max(6, s.contenido.split("\n").length + 2)} style={{ width: "100%", fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, padding: 10 }} onBlur={(e) => e.target.value !== s.contenido && guardarSec(s, { contenido: e.target.value })} />
              : <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 14 }}>{s.contenido ? linkify(s.contenido) : <span className="hint">Vacío. Pulsa «editar».</span>}</div>}
            <div className="hint" style={{ marginTop: 6 }}>actualizado {s.updated_at.slice(0, 10)}</div>
          </div>
        </Fragment>))}
      <div className="center no-print" style={{ margin: "6px 0 14px" }}><button className="btn ghost sm" type="button" onClick={nuevaSec}>+ sección</button></div>

      {/* ---------- inventario ---------- */}
      <h2>{secs.length + 1} · Inventario · dónde está cada cosa</h2>
      {CAT_ORDEN.filter((c) => vis.some((a) => a.categoria === c) || !filtro).map((c) => (
        <div key={c} className="card">
          <div className="ct"><span>{CAT[c]}</span><span className="no-print"><button className="link" type="button" onClick={() => nuevoAct(c)}>+ agregar</button></span></div>
          {vis.filter((a) => a.categoria === c).sort((a, b) => a.orden - b.orden).map((a) => (
            <div key={a.id} id={"act-" + a.id} style={{ borderTop: "1px solid var(--border-soft)", padding: "10px 0", scrollMarginTop: 80 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <b style={{ color: "var(--ink)", fontSize: 15 }}>{edit === a.id ? <input type="text" defaultValue={a.nombre} onBlur={(e) => e.target.value.trim() && e.target.value !== a.nombre && guardarAct(a, { nombre: e.target.value.trim() })} /> : a.nombre}{a.numero && edit !== a.id ? <span className="badge" style={{ marginLeft: 8 }}>{a.numero}</span> : null}{edit !== a.id && (saldoTxt(a) || a.suma_asegurada) ? <span style={{ marginLeft: 10, fontSize: 16, fontFamily: "Fraunces, serif", fontWeight: 900 }}>{saldoTxt(a) ?? a.suma_asegurada}</span> : null}</b>
                <span className="no-print" style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="hint">revisado {a.ultima_revision ?? "—"}</span>
                  <button className="link" type="button" onClick={() => revisado(a)} title="Marcar como revisado hoy">✓ revisado</button>
                  <button className="link" type="button" onClick={() => setEdit(edit === a.id ? null : a.id)}>{edit === a.id ? "listo" : "editar"}</button>
                  {edit === a.id && <button className="del" type="button" onClick={() => borrarAct(a)}>✕</button>}
                </span>
              </div>
              {edit === a.id ? (
                <div className="g4" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 4 }}>
                  <div><label>Categoría</label><select value={a.categoria} onChange={(e) => guardarAct(a, { categoria: e.target.value })}>{CAT_ORDEN.map((x) => <option key={x} value={x}>{CAT[x]}</option>)}</select></div>
                  {CAMPOS.map((f) => <div key={f.k} style={f.multi ? { gridColumn: "span 2" } : undefined}><label>{f.l}</label>{f.multi
                    ? <textarea defaultValue={(a[f.k] as string) ?? ""} rows={3} style={{ width: "100%", fontFamily: "inherit", fontSize: 13 }} onBlur={(e) => e.target.value !== (a[f.k] ?? "") && guardarAct(a, { [f.k]: e.target.value || null })} />
                    : <input type="text" defaultValue={(a[f.k] as string) ?? ""} onBlur={(e) => e.target.value !== (a[f.k] ?? "") && guardarAct(a, { [f.k]: e.target.value || null })} />}</div>)}
                  <div><label>Cuenta del CRM (saldo en vivo)</label><select value={a.cuenta_id ?? ""} onChange={(e) => guardarAct(a, { cuenta_id: e.target.value || null })}><option value="">— ninguna —</option>{initial.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {fmtMx(c.saldo_mxn)}</option>)}</select></div>
                  <div><label>Instrucción (sección)</label><select value={a.seccion_clave ?? ""} onChange={(e) => guardarAct(a, { seccion_clave: e.target.value || null })}><option value="">— ninguna —</option>{secs.map((x) => <option key={x.clave} value={x.clave}>{x.titulo}</option>)}</select></div>
                  <div><label>Vigencia desde</label><input type="date" value={a.vigencia_inicio ?? ""} onChange={(e) => guardarAct(a, { vigencia_inicio: e.target.value || null })} /></div>
                  <div><label>Vigencia hasta</label><input type="date" value={a.vigencia_fin ?? ""} onChange={(e) => guardarAct(a, { vigencia_fin: e.target.value || null })} /></div>
                  <div><label>Última revisión</label><input type="date" value={a.ultima_revision ?? ""} onChange={(e) => guardarAct(a, { ultima_revision: e.target.value || null })} /></div>
                  <div style={{ gridColumn: "span 2" }}><label>Documento (se guarda aquí, cifrado en el sistema)</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {a.documento_path ? <><button className="btn ghost sm" type="button" onClick={() => abrir(a.documento_path!)}>abrir</button><button className="del" type="button" onClick={() => quitarDoc(a)}>quitar</button><span className="hint">{a.documento_path.split("/").pop()}</span></> : <span className="hint">sin archivo</span>}
                      <input type="file" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(a, f); e.target.value = ""; }} />
                    </div></div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 16px", marginTop: 6, fontSize: 13 }}>
                  {saldoTxt(a) && <div><span className="hint">Saldo hoy: </span><b style={{ color: "var(--ink)" }}>{saldoTxt(a)}</b> <span className="hint">({cta(a)?.nombre})</span></div>}
                  {a.vigencia_fin && <div><span className="hint">Vigencia: </span><span className={vig(a) === "vencida" ? "neg" : vig(a) === "vence pronto" ? "" : "pos"}>{a.vigencia_inicio ?? "?"} → {a.vigencia_fin} · {vig(a)}</span></div>}
                  {secDe(a) && <div className="no-print"><span className="hint">Instrucción: </span><button className="link" type="button" onClick={() => ir("sec-" + secDe(a)!.id)}>{secDe(a)!.titulo}</button></div>}
                  {CAMPOS.filter((f) => a[f.k]).map((f) => <div key={f.k} style={f.multi ? { gridColumn: "1 / -1" } : undefined}><span className="hint">{f.l}: </span>{f.k === "liga" ? <a href={a.liga!} target="_blank" rel="noreferrer">{a.liga!.replace(/^https?:\/\//, "").slice(0, 60)}…</a> : <span style={{ whiteSpace: "pre-wrap" }}>{linkify(String(a[f.k]))}</span>}</div>)}
                  {a.documento_path && <div><span className="hint">Documento: </span><button className="link" type="button" onClick={() => abrir(a.documento_path!)}>abrir {a.documento_path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "")}</button></div>}
                </div>)}
            </div>))}
          {!vis.some((a) => a.categoria === c) && <p className="hint">Nada aquí todavía.</p>}
        </div>))}

      <p className="hint">Consejo: revisa este protocolo una vez al año (marca «✓ revisado»). Para que Sofía y mamá puedan verlo se les dará acceso de solo lectura más adelante, con doble factor.</p>
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}
