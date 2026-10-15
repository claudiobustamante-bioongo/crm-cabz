"use client";
import { useMemo, useState } from "react";
import type { Catalogo, Clasificacion, Cuenta, Evento, Rubro } from "@/lib/types";
import { CLS_LABEL, hoy } from "@/lib/format";

export interface NuevoGasto {
  fecha: string;
  grupo: Rubro;          // rubro nivel 1
  rubro: Rubro;          // subrubro
  monto: number;
  cuenta: Cuenta;
  libro: string;
  pagador: string;
  evento: string | null;
  nota: string;
  repetir: boolean;      // resto del año como presupuesto
  msi: number;           // meses sin intereses (0 = no aplica); monto = total de la compra
}

interface Props {
  rubros: Rubro[];
  cuentas: Cuenta[];
  libros: Catalogo[];
  pagadores: Catalogo[];
  eventos: Evento[];
  busy: boolean;
  onAgregar: (g: NuevoGasto) => Promise<void>;
  onNuevoRubro: (nombre: string, cls: Clasificacion, padre: Rubro | null) => Promise<Rubro | null>;
}

/** Libro por defecto según el rubro: Akela → AKELA, Bioongo → BIOONGO, Periplo → PERIPLO, resto PERSONAL. */
export const libroDe = (grupo: string) =>
  ({ Akela: "AKELA", Bioongo: "BIOONGO", Periplo: "PERIPLO", Cordada: "CORDADA" } as Record<string, string>)[grupo] ?? "PERSONAL";

export function Formulario({ rubros, cuentas, libros, pagadores, eventos, busy, onAgregar, onNuevoRubro }: Props) {
  const grupos = useMemo(() => rubros.filter((r) => !r.padre_id), [rubros]);
  const medios = useMemo(() => cuentas.filter((c) => c.es_medio_pago), [cuentas]);

  const [grupoId, setGrupoId] = useState(grupos[0]?.id ?? "");
  const subs = useMemo(() => rubros.filter((r) => r.padre_id === grupoId), [rubros, grupoId]);
  const [rubroId, setRubroId] = useState("");
  const [monto, setMonto] = useState("");
  const [cuentaId, setCuentaId] = useState(medios.find((c) => c.nombre === "AMEX")?.id ?? medios[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy());
  const [nota, setNota] = useState("");
  const [eventoId, setEventoId] = useState("");
  const [libro, setLibro] = useState("");       // '' = automático
  const [pagador, setPagador] = useState("CABZ");
  const [repetir, setRepetir] = useState(false);
  const [msi, setMsi] = useState(0);          // 0 = una vez
  const [nuevo, setNuevo] = useState<null | "grupo" | "sub">(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoCls, setNuevoCls] = useState<Clasificacion>("G");
  const [msg, setMsg] = useState("");

  const grupo = grupos.find((g) => g.id === grupoId) ?? null;
  const rubro = subs.find((s) => s.id === rubroId) ?? subs[0] ?? null;
  const libroEf = libro || libroDe(grupo?.nombre ?? "");

  const cambiarGrupo = (v: string) => {
    if (v === "__new") { setNuevo("grupo"); return; }
    setNuevo(null); setGrupoId(v); setRubroId(""); setLibro("");
  };
  const cambiarSub = (v: string) => {
    if (v === "__new") { setNuevo("sub"); return; }
    setNuevo(null); setRubroId(v);
  };

  const crear = async () => {
    const n = nuevoNombre.trim();
    if (!n) return;
    const r = await onNuevoRubro(n, nuevoCls, nuevo === "sub" ? grupo : null);
    if (!r) return;
    if (nuevo === "grupo") { setGrupoId(r.id); setRubroId(""); } else setRubroId(r.id);
    setNuevo(null); setNuevoNombre("");
  };

  const agregar = async () => {
    const m = Number(monto);
    if (!m || m <= 0) { setMsg("Escribe el monto."); return; }
    if (!grupo || !rubro) { setMsg("Elige rubro y subrubro."); return; }
    const cuenta = medios.find((c) => c.id === cuentaId);
    if (!cuenta) { setMsg("Elige con qué pagaste."); return; }
    setMsg("");
    await onAgregar({ fecha, grupo, rubro, monto: m, cuenta, libro: libroEf, pagador, evento: eventoId || null, nota: nota.trim(), repetir, msi });
    setMonto(""); setNota(""); setRepetir(false); setMsi(0);
  };

  return (
    <div className={"card" + (busy ? " spin" : "")}>
      <div className="ct">Registrar un gasto</div>
      <div className="g3">
        <div>
          <label htmlFor="g-cat">Rubro</label>
          <select id="g-cat" value={nuevo === "grupo" ? "__new" : grupoId} onChange={(e) => cambiarGrupo(e.target.value)}>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.emoji ? g.emoji + " " : ""}{g.nombre}</option>)}
            <option value="__new">+ Nuevo rubro…</option>
          </select>
        </div>
        <div>
          <label htmlFor="g-sub">Subrubro <span className="h">(Netflix, Vacaciones…)</span></label>
          <select id="g-sub" value={nuevo === "sub" ? "__new" : (rubro?.id ?? "")} onChange={(e) => cambiarSub(e.target.value)}>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            <option value="__new">+ Nuevo subrubro…</option>
          </select>
        </div>
        <div>
          <label htmlFor="g-monto">Monto</label>
          <input id="g-monto" type="number" inputMode="decimal" step="0.01" placeholder="0" value={monto}
            onChange={(e) => setMonto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        </div>
      </div>

      {nuevo && (
        <div className="g3">
          <div>
            <label htmlFor="g-new">{nuevo === "grupo" ? "Nombre del nuevo rubro" : `Nuevo subrubro de ${grupo?.nombre ?? ""}`}</label>
            <input id="g-new" type="text" value={nuevoNombre} placeholder={nuevo === "grupo" ? "p. ej. Mascotas" : "p. ej. Streaming"}
              onChange={(e) => setNuevoNombre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && crear()} autoFocus />
          </div>
          <div>
            <label>Clasificación {nuevo === "sub" && <span className="h">(hereda la del rubro si la dejas igual)</span>}</label>
            <div className="pills" style={{ marginTop: 0 }}>
              {(["N", "G", "A", "D"] as Clasificacion[]).map((c) => (
                <button key={c} type="button" className="pill" aria-pressed={nuevoCls === c} onClick={() => setNuevoCls(c)}>{CLS_LABEL[c]}</button>
              ))}
            </div>
          </div>
          <div>
            <label>&nbsp;</label>
            <button className="btn ghost sm" type="button" onClick={crear}>Crear</button>
            <button className="link" type="button" style={{ marginLeft: 8 }} onClick={() => setNuevo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="g3">
        <div>
          <label htmlFor="g-cta">Pagado con</label>
          <select id="g-cta" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
            {medios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="g-fecha">Fecha</label>
          <input id="g-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div>
          <label htmlFor="g-nota">Nota <span className="h">(opcional)</span></label>
          <input id="g-nota" type="text" placeholder="Huatulco, súper quincena…" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
      </div>

      <div className="g3">
        <div>
          <label htmlFor="g-libro">Libro <span className="h">(a quién se carga)</span></label>
          <select id="g-libro" value={libroEf} onChange={(e) => setLibro(e.target.value)}>
            {libros.map((l) => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="g-pag">Pagado por</label>
          <select id="g-pag" value={pagador} onChange={(e) => setPagador(e.target.value)}>
            {pagadores.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="g-ev">Evento <span className="h">(opcional)</span></label>
          <select id="g-ev" value={eventoId} onChange={(e) => setEventoId(e.target.value)}>
            <option value="">—</option>
            {eventos.map((ev) => <option key={ev.id} value={ev.id}>{ev.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="pills">
        <button type="button" className="pill" aria-pressed={!repetir && !msi} onClick={() => { setRepetir(false); setMsi(0); }}>Una vez</button>
        <button type="button" className="pill" aria-pressed={repetir} onClick={() => { setRepetir(true); setMsi(0); }}>Se repite cada mes <span className="h">(resto del año como presupuesto)</span></button>
        <button type="button" className="pill" aria-pressed={msi > 0} onClick={() => { setRepetir(false); setMsi(msi || 12); }}>A meses sin intereses</button>
        {msi > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="number" min={2} max={48} value={msi} onChange={(e) => setMsi(Math.max(2, +e.target.value || 2))} style={{ width: 64, padding: "5px 8px", fontSize: 13 }} aria-label="Número de meses" /> meses
            {Number(monto) > 0 && <span className="h">→ {(Number(monto) / msi).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })}/mes</span>}
          </span>
        )}
      </div>
      {msi > 0 && <p className="hint">Escribe el <b>total de la compra</b>; se registran {msi} cargos mensuales iguales a partir de la fecha, cada uno en su mes (como caen en la tarjeta).</p>}
      {msg && <div className="err" role="alert">{msg}</div>}
      <div className="center"><button className="btn" type="button" onClick={agregar} disabled={busy}>+ Agregar gasto</button></div>
      <p className="hint" style={{ textAlign: "center" }}>Se guarda en Supabase al instante vía <code>registrar_movimiento</code>. Akela, Bioongo y Periplo se cargan a su libro automáticamente.</p>
    </div>
  );
}
