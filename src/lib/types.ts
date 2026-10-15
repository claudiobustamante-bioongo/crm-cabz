export type Clasificacion = "N" | "G" | "A" | "D";

export interface Rubro {
  id: string;
  codigo: string;
  nombre: string;
  padre_id: string | null;
  clasificacion: Clasificacion | null;
  emoji: string | null;
  activo: boolean;
}

export interface Cuenta {
  id: string;
  nombre: string;
  tipo: string;
  es_medio_pago: boolean;
}

export interface Catalogo {
  codigo: string;
  nombre: string;
}

export interface Evento {
  id: string;
  nombre: string;
}

/** Fila de v_movimientos (solo lo que usa la app). */
export interface Movimiento {
  id: string;
  fecha: string;          // YYYY-MM-DD
  mes: string;            // YYYY-MM-01
  tipo: string;
  estado: "real" | "presupuesto";
  descripcion: string | null;
  monto: number;
  monto_mxn: number;
  moneda: string;
  cuenta: string;
  grupo: string;          // rubro nivel 1
  grupo_codigo: string;
  rubro: string;          // subrubro
  rubro_codigo: string;
  evento: string | null;
  notas: string | null;
}

export interface Asignacion {
  movimiento_id: string;
  libro: string;
  pagador: string;
  monto: number;
}

export interface GastosData {
  anio: number;
  anios: number[];
  rubros: Rubro[];
  cuentas: Cuenta[];
  libros: Catalogo[];
  pagadores: Catalogo[];
  eventos: Evento[];
  movimientos: Movimiento[];
  asignaciones: Asignacion[];
}

export type TipoIngreso = "sueldo" | "comision" | "bono" | "dividendo_interes" | "reembolso" | "aportacion_akela" | "otro";

/** Fila de v_ingresos. */
export interface Ingreso {
  id: string;
  fecha: string;
  mes: string;
  estado: "real" | "presupuesto";
  descripcion: string | null;
  monto: number;
  monto_mxn: number;
  moneda: string;
  cuenta: string;
  cuenta_destino: string | null;
  tiene_cfdi: boolean;
  cfdi_uuid: string | null;
  notas: string | null;
  tipo: TipoIngreso;
  bruto: number | null;
  iva: number;
  ret_isr: number;
  ret_iva: number;
  cliente: string | null;
  proyectado: boolean;
  aporta: string | null;
  aporta_nombre: string | null;
}

/** Salida mensual (gasto + ahorro + abono a deuda, reales) para liquidez. */
export interface SalidaMes {
  mes: string;   // YYYY-MM
  total: number;
}

export interface IngresosData {
  anio: number;
  anios: number[];
  cuentas: Cuenta[];
  pagadores: Catalogo[];
  ingresos: Ingreso[];
  salidas: SalidaMes[];
}

/** Fila de ibkr_estados_mensuales (importes USD). */
export interface IbkrMes {
  id: string;
  cuenta_id: string;
  periodo: string;   // YYYY-MM-01
  real_etf: number; real_acc: number; real_opc: number; real_fx: number; real_bono: number;
  nr_etf: number; nr_acc: number; nr_opc: number; nr_fx: number; nr_bono: number;
  div_bruto: number; div_ret: number; cupon: number; cupon_ret: number;
  comisiones: number; int_broker: number; depositos: number;
  nav_efe: number; nav_acc: number; nav_opc: number; nav_bono: number; nav_dev: number; nav_final: number;
  fuente: string | null;
}

export interface TipoCambio { fecha: string; moneda: string; tc_mxn: number; fuente: string }

export interface CuentaSaldo { id: string; nombre: string; tipo: string; moneda: string; titular: string; saldo: number | null; fecha: string | null; fuente: string | null }

export interface NetWorth { retiro_inversion_mxn: number; efectivo_mxn: number; tarjetas_mxn: number; prestamos_mxn: number; neto_mxn: number }

export interface InversionesData {
  cuentasIbkr: { id: string; nombre: string; titular: string }[];
  filas: IbkrMes[];
  tc: TipoCambio[];
  retiro: CuentaSaldo[];
  netWorth: NetWorth | null;
  banxico: boolean;   // hay token configurado en el servidor
  flex: boolean;      // hay token + query de IBKR Flex en el servidor
  flexHoy: boolean;   // hay query Month-to-Date para el NAV de hoy
}
