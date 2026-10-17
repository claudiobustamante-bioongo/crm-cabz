"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Asignacion, Clasificacion, GastosData, Movimiento, Rubro } from "@/lib/types";
import { CLS_COLOR, CLS_LABEL, color, cuentaColor, fmt, mesKey, ml, slug } from "@/lib/format";
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
  const [edit, setEdit] = useState<{ id: string; fecha: string; monto: string; cuenta_id: string; rubro_id: string; notas: string } | null>(null);
  const empezarEdicion = (m: Movimiento) => setEdit({ id: m.id, fecha: m.fecha, monto: String(m.monto), cuenta_id: m.cuenta_id ?? "", rubro_id: m.rubro_id ?? "", notas: m.notas ?? "" });
  const guardarEdicion = async () => {
    if (!edit) return;
    const monto = Number(edit.monto);
    if (!(monto > 0)) return aviso("Monto inválido.");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("editar_movimiento", { p: { id: edit.id, fecha: edit.fecha, monto, cuenta_id: edit.cuenta_id || null, rubro_id: edit.rubro_id || null, notas: edit.notas } });
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
                      <td>{as.map((a) => `${a.libro}${a.pagador !== "CABZ" ? " · " + a.pagador : ""}`).join(", ")}</td>
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
                    <td style={{ whiteSpace: "normal", color: "var(--gray-soft)" }}>{[m.evento, m.notas].filter(Boolean).join(" · ")}</td>
                    <td className="n" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmt(m.monto_mxn)}</td>
                    <td style={{ whiteSpace: "nowrap" }}><button className="link" type="button" aria-label="Editar" title="Editar" onClick={() => empezarEdicion(m)}>✎</button> <button className="del" type="button" aria-label="Borrar" onClick={() => borrar(m)}>✕</button></td>
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
