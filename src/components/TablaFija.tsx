"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Contenedor de tabla ancha: primera columna fija a la izquierda, última fija a la derecha,
 * y una barra de desplazamiento arriba (además de la de abajo) sincronizada.
 */
export function TablaFija({ children, fijarUltima = true, fontSize, alto }: { children: ReactNode; fijarUltima?: boolean; fontSize?: number; alto?: string }) {
  const top = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = body.current; if (!el) return;
    const medir = () => setW(el.scrollWidth);
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [children]);
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => { if (from && to && Math.abs(from.scrollLeft - to.scrollLeft) > 1) to.scrollLeft = from.scrollLeft; };
  return (
    <div className={"tbl-fija" + (fijarUltima ? " ultima" : "")} style={fontSize ? { fontSize } : undefined}>
      <div ref={top} className="tbl-scroll-top" onScroll={() => sync(top.current, body.current)} aria-hidden><div style={{ width: w, height: 1 }} /></div>
      <div ref={body} className="tbl" style={alto ? { maxHeight: alto, overflowY: "auto" } : undefined} onScroll={() => sync(body.current, top.current)}>{children}</div>
    </div>
  );
}
