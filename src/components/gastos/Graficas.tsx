"use client";
import { color, fmt, ml, niceStep } from "@/lib/format";

/** Dona por rubro: [nombre, monto] ordenados desc. */
export function Dona({ cats, tot, sel }: { cats: [string, number][]; tot: number; sel: string }) {
  const R = 84, r = 54, cx = 120, cy = 120, rm = (R + r) / 2;
  let a = 0;
  const arcs = cats.map(([c, v]) => {
    const f = v / (tot || 1);
    if (f <= 0) return null;
    const a1 = a + f * 2 * Math.PI * 0.99999;
    const d = `M${cx + rm * Math.sin(a)},${cy - rm * Math.cos(a)} A${rm},${rm} 0 ${a1 - a > Math.PI ? 1 : 0} 1 ${cx + rm * Math.sin(a1)},${cy - rm * Math.cos(a1)}`;
    a = a1;
    return (
      <path key={c} d={d} stroke={color(c)} strokeWidth={R - r} fill="none" opacity={sel && sel !== c ? 0.3 : 1}>
        <title>{`${c} ${Math.round(f * 100)}%`}</title>
      </path>
    );
  });
  const top: [string, number] = sel ? [sel, cats.find((x) => x[0] === sel)?.[1] ?? 0] : cats[0] ?? ["—", 0];
  return (
    <svg viewBox="0 0 240 240" style={{ width: 220, maxWidth: "60vw" }} role="img" aria-label="Porcentaje por rubro">
      {arcs}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--ink)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ink)" strokeWidth={2} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="Fraunces,serif" fontSize={22} fontWeight={900} fill="var(--green-deep)">
        {tot ? Math.round((top[1] / tot) * 100) : 0}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={9.5} fill="var(--gray-soft)">{top[0].slice(0, 22)}</text>
    </svg>
  );
}

/** Barras apiladas por mes y rubro. data[mes][rubro] = monto. */
export function BarrasMes({ meses, rubros, data }: { meses: string[]; rubros: string[]; data: Record<string, Record<string, number>> }) {
  const W = 760, H = 210, P = { l: 54, r: 8, t: 10, b: 26 };
  const totales = meses.map((k) => Object.values(data[k] ?? {}).reduce((a, v) => a + Math.max(0, v), 0));
  const step = niceStep(Math.max(...totales, 1)), max = Math.ceil(Math.max(...totales, 1) / step) * step;
  const bw = (W - P.l - P.r) / Math.max(1, meses.length), y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  const grid = [];
  for (let v = 0; v <= max; v += step) grid.push(v);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Gasto por mes">
      {grid.map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" />
          <text x={P.l - 6} y={y(v) + 4} textAnchor="end">{v >= 1000 ? Math.round(v / 1000) + "k" : v}</text>
        </g>
      ))}
      {meses.map((k, i) => {
        let acc = 0;
        const x = P.l + i * bw + bw * 0.18, w = bw * 0.64;
        return (
          <g key={k}>
            {rubros.map((rb) => {
              const v = Math.max(0, data[k]?.[rb] ?? 0);
              if (!v) return null;
              const el = (
                <rect key={rb} x={x} y={y(acc + v)} width={w} height={y(acc) - y(acc + v)} fill={color(rb)} stroke="var(--ink)" strokeWidth={0.6}>
                  <title>{`${ml(k)} · ${rb}: ${fmt(v)}`}</title>
                </rect>
              );
              acc += v;
              return el;
            })}
            <text x={x + w / 2} y={H - 8} textAnchor="middle">{ml(k)}</text>
          </g>
        );
      })}
    </svg>
  );
}
