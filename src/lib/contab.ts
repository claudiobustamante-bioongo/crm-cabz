/* Cálculos de la pestaña Contabilidad, compartidos por la pantalla y el Excel. */
import type { AjusteFiscal, ContabMes, IbkrMes, TipoCambio } from "./types";

export const PERDIDA_ANIOS = 10;   // art. 129 LISR: pérdidas por enajenación de acciones en bolsa, amortizables 10 ejercicios
export const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export const yOf = (r: IbkrMes) => +r.periodo.slice(0, 4);
export const mOf = (r: IbkrMes) => +r.periodo.slice(5, 7);

/** FIX del mes (o el más reciente anterior). */
export function tcFn(tc: TipoCambio[]) {
  const map = Object.fromEntries(tc.map((t) => [t.fecha.slice(0, 7), t.tc_mxn]));
  return (y: number, m: number) => {
    for (let yy = y; yy >= y - 2; yy--) for (let mm = yy === y ? m : 12; mm >= 1; mm--) { const v = map[`${yy}-${String(mm).padStart(2, "0")}`]; if (v) return v; }
    return 0;
  };
}

export interface InvAnual {
  cuenta_id: string; cuenta: string; titular: string; anio: number;
  usd: { etf: number; acc: number; opc: number; fx: number; bono: number; realizada: number; div_bruto: number; div_ret: number; cupon: number; cupon_ret: number; comisiones: number; interes: number; depositos: number; nav: number; nr: number };
  mxn: { etf: number; acc: number; opc: number; fx: number; bono: number; realizada: number; div_bruto: number; div_ret: number; cupon: number; cupon_ret: number; comisiones: number; interes: number; depositos: number; nav: number; nr: number };
  meses: number;
}

/** Resumen por cuenta y año: flujos sumados mes a mes (USD, y MXN al FIX de cada mes); NAV y no realizada al cierre. */
export function resumenInversiones(ibkr: IbkrMes[], cuentas: { id: string; nombre: string; titular: string }[], tc: TipoCambio[]): InvAnual[] {
  const fix = tcFn(tc);
  const out: InvAnual[] = [];
  for (const c of cuentas) {
    const anios = [...new Set(ibkr.filter((r) => r.cuenta_id === c.id).map(yOf))].sort();
    for (const y of anios) {
      const rs = ibkr.filter((r) => r.cuenta_id === c.id && yOf(r) === y).sort((a, b) => mOf(a) - mOf(b));
      const z = () => ({ etf: 0, acc: 0, opc: 0, fx: 0, bono: 0, realizada: 0, div_bruto: 0, div_ret: 0, cupon: 0, cupon_ret: 0, comisiones: 0, interes: 0, depositos: 0, nav: 0, nr: 0 });
      const u = z(), m = z();
      const flujos: [keyof ReturnType<typeof z>, (r: IbkrMes) => number][] = [["etf", (r) => r.real_etf], ["acc", (r) => r.real_acc], ["opc", (r) => r.real_opc], ["fx", (r) => r.real_fx], ["bono", (r) => r.real_bono],
        ["div_bruto", (r) => r.div_bruto], ["div_ret", (r) => r.div_ret], ["cupon", (r) => r.cupon], ["cupon_ret", (r) => r.cupon_ret], ["comisiones", (r) => r.comisiones], ["interes", (r) => r.int_broker], ["depositos", (r) => r.depositos]];
      for (const r of rs) { const t = fix(y, mOf(r)); for (const [k, f] of flujos) { const v = f(r) || 0; u[k] += v; m[k] += v * t; } }
      u.realizada = u.etf + u.acc + u.opc + u.fx + u.bono; m.realizada = m.etf + m.acc + m.opc + m.fx + m.bono;
      const last = rs.at(-1)!; const tl = fix(y, mOf(last));
      u.nav = last.nav_final; m.nav = last.nav_final * tl;
      u.nr = last.nr_etf + last.nr_acc + last.nr_opc + last.nr_fx + last.nr_bono; m.nr = u.nr * tl;
      out.push({ cuenta_id: c.id, cuenta: c.nombre.replace(/^IBKR /, ""), titular: c.titular, anio: y, usd: u, mxn: m, meses: rs.length });
    }
  }
  return out;
}

export interface PerdidaFila { anio: number; resultado: number; perdida: number; aplicada: number; remanente: number; vence: number; origen: "ibkr" | "ajuste"; concepto: string }

/**
 * Pérdidas por amortizar (Cap. IV, enajenación de acciones/ETFs; art. 129): cada año con resultado realizado negativo
 * genera una pérdida que se aplica contra ganancias de los siguientes PERDIDA_ANIOS ejercicios, en orden (FIFO).
 * Consolidado de todas las cuentas (o solo un titular si se indica). Los ajustes manuales tipo 'perdida_acciones' entran como pérdidas adicionales de su año.
 */
export function perdidasPorAmortizar(inv: InvAnual[], ajustes: AjusteFiscal[], titular?: string) {
  const porAnio: Record<number, number> = {};
  inv.filter((i) => !titular || i.titular === titular).forEach((i) => { porAnio[i.anio] = (porAnio[i.anio] ?? 0) + i.mxn.realizada; });
  const anios = [...new Set([...Object.keys(porAnio).map(Number), ...ajustes.filter((a) => a.tipo === "perdida_acciones").map((a) => a.anio)])].sort();
  const filas: PerdidaFila[] = [];
  const pool: { anio: number; rem: number; idx: number }[] = [];
  for (const y of anios) {
    const res = porAnio[y] ?? 0;
    // 1) aplica pérdidas previas vigentes contra la ganancia del año
    let gan = Math.max(0, res);
    for (const p of pool) { if (p.rem <= 0 || y > p.anio + PERDIDA_ANIOS || y <= p.anio) continue; const ap = Math.min(p.rem, gan); p.rem -= ap; gan -= ap; filas[p.idx].aplicada += ap; filas[p.idx].remanente = p.rem; }
    // 2) la pérdida del año entra al pool
    if (res < 0) { filas.push({ anio: y, resultado: res, perdida: -res, aplicada: 0, remanente: -res, vence: y + PERDIDA_ANIOS, origen: "ibkr", concepto: "Pérdida realizada IBKR (todas las cuentas)" }); pool.push({ anio: y, rem: -res, idx: filas.length - 1 }); }
    else filas.push({ anio: y, resultado: res, perdida: 0, aplicada: 0, remanente: 0, vence: 0, origen: "ibkr", concepto: `Ganancia realizada ${res > 0 ? `· absorbe ${(Math.max(0, res) - gan).toFixed(0)} de pérdidas previas` : ""}` });
    for (const a of ajustes.filter((a) => a.tipo === "perdida_acciones" && a.anio === y)) {
      filas.push({ anio: y, resultado: 0, perdida: a.monto, aplicada: a.amortizado, remanente: a.monto - a.amortizado, vence: y + PERDIDA_ANIOS, origen: "ajuste", concepto: a.concepto });
      pool.push({ anio: y, rem: a.monto - a.amortizado, idx: filas.length - 1 });
    }
  }
  return filas;
}

export const mesContab = (m: ContabMes[], anio: number, mes: number) => m.find((x) => x.anio === anio && x.mes === mes);
