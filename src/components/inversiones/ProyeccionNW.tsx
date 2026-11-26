"use client";
import { Proyeccion } from "@/components/Proyeccion";
import { fmt } from "@/lib/format";

/** Net worth de cuentas propias: ahorro esperado 1.3M/año (±10/15/20 %) y mínimo 480k/año, definidos por Claudio (nov 2026). */
type Props = { netoHoy: number; ingresos12: number; gastos12: number; deuda12: number; desde: string; hasta: string };
const ESPERADO = 1_300_000, MINIMO = 480_000;

export function ProyeccionNW({ netoHoy, ingresos12, gastos12, deuda12, desde, hasta }: Props) {
  const historico = Math.round(ingresos12 - gastos12 - deuda12);
  return (
    <Proyeccion id="nw" titulo="Proyección de tu net worth" tag={<>cuentas propias · hoy {fmt(netoHoy)}</>} inicial={netoHoy}
      aportes={[{ label: "Ahorro anual esperado", def: ESPERADO }]}
      minimo={{ label: "Mínimo", def: MINIMO }}
      nota={<>Referencia histórica (12 meses, {desde} a {hasta}): ingresos {fmt(ingresos12)} − gastos que pagas tú {fmt(gastos12)} − abonos a deuda {fmt(deuda12)} = <b>{fmt(historico)}</b>.</>} />
  );
}
