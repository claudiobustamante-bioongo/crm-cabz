"use client";
import { useState } from "react";

/** Lista con buscador: escribe para filtrar; clic en una opción la elige. */
export function Buscador<T>({ items, texto, render, onElegir, placeholder = "buscar…", max = 25 }: { items: T[]; texto: (t: T) => string; render: (t: T) => React.ReactNode; onElegir: (t: T) => void; placeholder?: string; max?: number }) {
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const lista = items.filter((t) => { const h = norm(texto(t)); return terms.every((w) => h.includes(w)); }).slice(0, max);
  return (
    <div style={{ border: "1.5px solid var(--ink)", borderRadius: 10, padding: 6, background: "var(--paper)", maxWidth: 520, fontSize: 12 }}>
      <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} style={{ padding: "5px 8px", fontSize: 12, marginBottom: 4 }} />
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {lista.map((t, i) => <button key={i} type="button" className="link" onClick={() => onElegir(t)} style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 6px", borderBottom: "1px solid var(--border-soft)", whiteSpace: "normal" }}>{render(t)}</button>)}
        {!lista.length && <div className="hint" style={{ padding: 6 }}>Sin coincidencias.</div>}
      </div>
    </div>
  );
}
