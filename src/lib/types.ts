export type Clasificacion = "N" | "G" | "A" | "D";

export interface Rubro {
  id: string;
  codigo: string;
  nombre: string;
  padre_id: string | null;
  clasificacion: Clasificacion | null;
  emoji: string | null;
  activo: boolean;
  deduccion?: string | null;   // categoría art. 151 (gmm, medico, ppr…)
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
  rubro_id?: string | null;
  cuenta_id?: string;
  cfdi_uuid?: string | null;
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
  cfdisSinLigar: CfdiMini[];   // recibidas del año sin gasto ligado, para enlazar desde la lista
  facturasPorMov: Record<string, number>;   // cuántas facturas tiene cada gasto
  saldos: { id: string; nombre: string; tipo: string; moneda: string; saldo: number; fecha_saldo_inicial: string | null }[];   // cheques y tarjetas, saldo según el CRM
  presupuestos: Presupuesto[];   // del año, libro y rubro
  ingresosMes: { mes: string; monto_mxn: number; proyectado: boolean; tipo: string }[];   // entradas del año (reales y proyectadas)
}
export interface Presupuesto { id: string; mes: string; libro: string; rubro_id: string; monto: number; notas: string | null }
export interface CfdiIngreso { uuid: string; fecha: string; tipo: string; tipo_comprobante: string; emisor_nombre: string | null; receptor_nombre: string | null; total: number; ret_isr: number; subtotal: number; iva: number; ret_iva: number }
export interface CfdiMini { uuid: string; fecha: string; emisor_nombre: string | null; total_mxn: number; concepto: string | null }

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
  rfcPropio: string | null;
  userId: string;
  cfdisLibres: CfdiIngreso[];   // nómina / emitidas del año sin ligar a un ingreso
  cheques: number;              // saldo en cheques (MXN) hoy
  hoy: string;
  pptoMes: Record<string, number>;        // presupuesto total por mes (YYYY-MM) del año
  pptoRestanteHoy: number;                // del mes en curso: suma por rubro de max(presupuesto − real, 0)
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

/** Fila de v_cfdi. */
export interface Cfdi {
  uuid: string;
  tipo: "emitida" | "recibida" | "nomina";
  tipo_comprobante: string | null;
  fecha: string;
  serie: string | null; folio: string | null;
  emisor_rfc: string; emisor_nombre: string | null;
  receptor_rfc: string; receptor_nombre: string | null;
  concepto: string | null; categoria: string | null; uso_cfdi: string | null;
  subtotal: number; descuento: number; iva: number; ret_isr: number; ret_iva: number; total: number;
  moneda: string; tc: number | null;
  forma_pago: string | null; metodo_pago: string | null;
  rubro_id: string | null; rubro: string | null; grupo: string | null;
  estado: "nueva" | "ligada" | "revisar" | "sin_gasto";
  notas: string | null;
  movimiento_id: string | null; movimiento: string | null; movimiento_fecha: string | null; movimiento_monto: number | null;
  cuenta: string | null;
  xml_path: string | null; pdf_path: string | null;
  xml_nombre: string | null; pdf_nombre: string | null;
  num: number; vencimiento: string | null; confianza: string | null; link_drive: string | null; total_mxn: number;
}

export interface CfdiMensual { anio: number; mes: string; tipo: string; facturas: number; total_mxn: number; iva: number; ret_isr: number; ret_iva: number; por_ligar: number; notas_credito?: number; pagos?: number }

/** Gasto sin CFDI, candidato a ligar. */
export interface GastoSinCfdi { id: string; fecha: string; descripcion: string; grupo: string; rubro: string; rubro_id: string | null; cuenta: string; monto_mxn: number; facturas?: number }

export interface DeduccionAnual { anio: number; categoria: string; registrado: number; con_comprobante: number; movimientos: number; facturas: number }

export interface FacturaExt { drive_id: string; nombre: string; carpeta: string | null; mes: string | null; link_drive: string | null; procesado_en: string; storage_path: string | null }

export interface FacturacionData {
  anio: number;
  anios: number[];
  rfcPropio: string | null;
  userId: string;
  cfdis: Cfdi[];
  sinCfdi: GastoSinCfdi[];
  rubros: Rubro[];
  cuentas: Cuenta[];
  libros: Catalogo[];
  deducciones: DeduccionAnual[];
  mensual: CfdiMensual[];
  extranjeras: FacturaExt[];
  drive: boolean;         // hay cuenta de servicio + carpeta configuradas
  ultimaSync: string | null;
  ingresoAnual: number;   // sueldo + bono + honorarios brutos del año (base para topes)
  uma: number;            // UMA diaria vigente
}

/* ---------- Contabilidad (para el contador) ---------- */
export interface ContabMes { anio: number; mes: number; emitidas_subtotal: number; emitidas_iva: number; emitidas_ret_isr: number; emitidas_ret_iva: number; emitidas_n: number; recibidas_total: number; recibidas_iva: number; recibidas_iva_acreditable: number; recibidas_n: number; nomina_neto: number; nomina_bruto: number; nomina_isr: number; nomina_n: number; emitidas_de_ingresos?: boolean; nomina_de_ingresos?: boolean }
export interface AjusteFiscal { id: string; anio: number; tipo: "perdida_acciones" | "perdida_actividad" | "otro"; concepto: string; monto: number; moneda: string; amortizado: number; notas: string | null }
export interface Obligacion { id: string; anio: number; mes: number; obligacion: string; vence: string; estado: "pendiente" | "presentada" | "pagada" | "no_aplica"; monto: number | null; notas: string | null }
export interface ContabilidadData {
  anio: number;
  anios: number[];
  rfcPropio: string | null;
  mensual: ContabMes[];          // todos los años
  cfdis: Cfdi[];                 // del año
  cuentasIbkr: { id: string; nombre: string; titular: string }[];
  ibkr: IbkrMes[];               // todos los años
  tc: TipoCambio[];
  deducciones: DeduccionAnual[]; // del año
  extranjeras: FacturaExt[];     // del año
  ajustes: AjusteFiscal[];
  obligaciones: Obligacion[];    // del año
  rubros: Rubro[];
  uma: number;
}

/* ---------- Akela ---------- */
export interface PlanAkela { id: string; anio: number; linea: string; categoria?: string | null; subrubro?: string | null; real_conciliado?: number | null; anual?: boolean; rubro_id: string | null; pagador: string; es_transferencia: boolean; mes: number; monto: number; notas: string | null }
export interface AkelaRealPlan { anio: number; mes: number; linea: string; rubro_id: string | null; plan: number; real: number; desviacion: number }
export interface LibroAkela { fecha: string; mes: string; concepto: "aportacion" | "gasto" | "retiro"; descripcion: string | null; quien: string | null; rubro: string | null; entrada_mxn: number; salida_mxn: number }
export interface MovAkela { id: string; fecha: string; descripcion: string | null; monto_mxn: number; rubro_id: string | null; notas: string | null; estado: string; cuenta: string | null; pagador: string | null }
export interface AkelaData {
  anio: number;
  anios: number[];
  rol: string | null;
  plan: PlanAkela[];           // del año
  realPlan: AkelaRealPlan[];   // del año
  libro: LibroAkela[];         // del año: aportaciones y gastos Akela
  fondo: { nombre: string; saldo: number; moneda: string; fecha: string | null; fuente: string | null }[];
  tcHoy: number;
  params: { nac_papa: number; nac_mama: number; rend_real: number; tc: number };
  rubrosAkela: { id: string; nombre: string }[];
  rubros: { id: string; nombre: string; codigo: string; padre_id: string | null }[];   // árbol completo de rubros de gasto
  movs: MovAkela[];            // gastos del año en el libro Akela (para la celda real y su detalle)
  medios: { id: string; nombre: string }[];   // cuentas con las que se paga
  destinos: { id: string; nombre: string; tipo: string }[];   // a dónde puede ir un depósito de Luis Miguel (fondo o cuentas mías)
  depLM: { id: string; fecha: string; monto_mxn: number; cuenta: string | null; cuenta_destino: string | null; descripcion: string | null }[];   // transferencias de Luis Miguel del año
  pagadores: Catalogo[];
}

/* ---------- Analíticas ---------- */
export interface AnaliticasData {
  hoy: string;
  meses: string[];                       // últimos 24 meses (YYYY-MM), el último es el actual
  ingresos: { mes: string; tipo: string; monto_mxn: number }[];
  gastos: { mes: string; fecha: string; tipo: string; libro: string; grupo: string; rubro: string; rubro_codigo: string; monto_mxn: number; clasificacion: string | null }[];   // mi parte (pagador CABZ), reales
  futuros: { fecha: string; mes: string; estado: string; descripcion: string | null; grupo: string | null; monto_mxn: number; notas: string | null; libro: string | null }[];   // gastos con fecha futura (MSI, presupuestos)
  deudas: { deuda: string; moneda: string; saldo_actual: number; proximo_pago_fecha: string | null; proximo_pago_monto: number | null; pagos_restantes: number | null; fecha_liquidacion: string | null; tasa_anual: number | null }[];
  cuentas: { id: string; nombre: string; tipo: string; moneda: string; saldo_mxn: number; saldo: number; fecha: string | null }[];   // mías, con saldo actual
  netWorth: NetWorth | null;
  navHist: { cuenta_id: string; periodo: string; nav_final: number }[];       // IBKR por mes (cuentas mías)
  saldosHist: { cuenta_id: string; fecha: string; saldo: number }[];          // retiro (AFORE, PPR…)
  tc: { fecha: string; tc_mxn: number }[];
  akela: { plan_ytd: number; real_ytd: number; plan_anual: number; fondo_mxn: number } | null;
}
