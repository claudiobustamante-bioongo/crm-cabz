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
