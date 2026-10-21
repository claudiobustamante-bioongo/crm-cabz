"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* Grupos de tablas que se desplazan juntas (una tabla por sección, mismas columnas). */
const grupos = new Map<string, Set<HTMLDivElement>>();
function registrar(g: string | undefined, el: HTMLDivElement | null) { if (!g || !el) return () => {}; const s = grupos.get(g) ?? new Set(); s.add(el); grupos.set(g, s); return () => { s.delete(el); }; }
function propagar(g: string | undefined, from: HTMLDivElement) { if (!g) return; grupos.get(g)?.forEach((el) => { if (el !== from && Math.abs(el.scrollLeft - from.scrollLeft) > 1) el.scrollLeft = from.scrollLeft; }); }

/**
 * Contenedor de tabla ancha: primera columna fija a la izquierda, última fija a la derecha,
 * barra de desplazamiento arriba (además de la de abajo) y, con `alto`, scroll vertical propio con encabezado congelado.
 * Con `grupo`, varias tablas se desplazan a la vez (una por sección).
 */
export function TablaFija({ children, fijarUltima = true, fontSize, alto, grupo, sinBarraArriba }: { children: ReactNode; fijarUltima?: boolean; fontSize?: number; alto?: string; grupo?: string; sinBarraArriba?: boolean }) {
  const top = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = body.current; if (!el) return;
    const medir = () => setW(el.scrollWidth);
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", medir); const t = setTimeout(medir, 300); const t2 = setTimeout(medir, 1500);
    const off = registrar(grupo, el);
    return () => { ro.disconnect(); off(); window.removeEventListener("resize", medir); clearTimeout(t); clearTimeout(t2); };
  }, [children, grupo]);
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => { if (from && to && Math.abs(from.scrollLeft - to.scrollLeft) > 1) to.scrollLeft = from.scrollLeft; };
  return (
    <div className={"tbl-fija" + (fijarUltima ? " ultima" : "")} style={fontSize ? { fontSize } : undefined}>
      {!sinBarraArriba && <div ref={top} className="tbl-scroll-top" onScroll={() => { sync(top.current, body.current); if (body.current) propagar(grupo, body.current); }} aria-hidden><div style={{ width: w, height: 1 }} /></div>}
      <div ref={body} className="tbl" style={alto ? { maxHeight: alto, overflowY: "auto" } : undefined} onScroll={() => { sync(body.current, top.current); if (body.current) { propagar(grupo, body.current); if (body.current.scrollWidth !== w) setW(body.current.scrollWidth); } }}>{children}</div>
    </div>
  );
}

/** Encabezado de sección fuera de la tabla (no se desplaza), con su propia barra encima de la tabla. */
export function Seccion({ titulo, children }: { titulo: ReactNode; children: ReactNode }) {
  return <div className="tbl-seccion"><div className="tbl-seccion-t">{titulo}</div>{children}</div>;
}
