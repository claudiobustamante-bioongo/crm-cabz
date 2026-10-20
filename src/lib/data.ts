import type { SupabaseClient } from "@supabase/supabase-js";
import type { AjusteFiscal, Asignacion, Catalogo, Cfdi, CfdiMensual, ContabMes, ContabilidadData, Cuenta, DeduccionAnual, Evento, FacturaExt, FacturacionData, GastoSinCfdi, GastosData, IbkrMes, Ingreso, IngresosData, InversionesData, Movimiento, NetWorth, Obligacion, Rubro, TipoCambio } from "./types";

const TIPOS_GASTO = ["gasto", "ahorro", "abono_deuda"];

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

export async function loadGastos(supabase: SupabaseClient, anio: number): Promise<GastosData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const [rubros, cuentas, libros, pagadores, eventos, movimientos, anios] = await Promise.all([
    supabase.from("rubros").select("id,codigo,nombre,padre_id,clasificacion,emoji,activo")
      .eq("naturaleza", "gasto").eq("activo", true).order("orden").order("nombre"),
    supabase.from("cuentas").select("id,nombre,tipo,es_medio_pago").eq("activa", true).order("nombre"),
    supabase.from("libros").select("codigo,nombre").eq("activo", true),
    supabase.from("pagadores").select("codigo,nombre").eq("activo", true),
    supabase.from("eventos").select("id,nombre").order("fecha_inicio", { ascending: false }),
    supabase.from("v_movimientos")
      .select("id,fecha,mes,tipo,estado,descripcion,monto,monto_mxn,moneda,cuenta,cuenta_id,grupo,grupo_codigo,rubro,rubro_id,rubro_codigo,evento,notas,cfdi_uuid")
      .in("tipo", TIPOS_GASTO).gte("fecha", desde).lte("fecha", hasta)
      .order("fecha", { ascending: false }).range(0, 9999),
    supabase.from("anios").select("anio").order("anio"),
  ]);

  const movs = must<Movimiento[]>(movimientos, "movimientos");
  const ids = movs.map((m) => m.id);
  const asignaciones = ids.length
    ? must<Asignacion[]>(
        await supabase.from("v_asignaciones").select("movimiento_id,libro,pagador,monto").in("movimiento_id", ids).range(0, 19999),
        "asignaciones",
      )
    : [];

  const listaAnios = must<{ anio: number }[]>(anios, "anios").map((a) => a.anio);
  if (!listaAnios.includes(anio)) listaAnios.push(anio);

  return {
    anio,
    anios: listaAnios.sort(),
    rubros: must<Rubro[]>(rubros, "rubros"),
    cuentas: must<Cuenta[]>(cuentas, "cuentas"),
    libros: must<Catalogo[]>(libros, "libros"),
    pagadores: must<Catalogo[]>(pagadores, "pagadores"),
    eventos: must<Evento[]>(eventos, "eventos"),
    movimientos: movs,
    asignaciones,
  };
}

export async function loadIngresos(supabase: SupabaseClient, anio: number): Promise<IngresosData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const [cuentas, pagadores, ingresos, salidas, anios] = await Promise.all([
    supabase.from("cuentas").select("id,nombre,tipo,es_medio_pago").eq("activa", true).order("nombre"),
    supabase.from("pagadores").select("codigo,nombre").eq("activo", true),
    supabase.from("v_ingresos").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 4999),
    supabase.from("v_movimientos").select("fecha,monto_mxn").in("tipo", TIPOS_GASTO).eq("estado", "real")
      .gte("fecha", desde).lte("fecha", hasta).range(0, 19999),
    supabase.from("anios").select("anio").order("anio"),
  ]);
  const porMes: Record<string, number> = {};
  must<{ fecha: string; monto_mxn: number }[]>(salidas, "salidas").forEach((s) => {
    const k = s.fecha.slice(0, 7); porMes[k] = (porMes[k] ?? 0) + Number(s.monto_mxn);
  });
  const listaAnios = must<{ anio: number }[]>(anios, "anios").map((a) => a.anio);
  if (!listaAnios.includes(anio)) listaAnios.push(anio);
  return {
    anio, anios: listaAnios.sort(),
    cuentas: must<Cuenta[]>(cuentas, "cuentas"),
    pagadores: must<Catalogo[]>(pagadores, "pagadores"),
    ingresos: must<Ingreso[]>(ingresos, "ingresos"),
    salidas: Object.entries(porMes).map(([mes, total]) => ({ mes, total })).sort((a, b) => a.mes.localeCompare(b.mes)),
  };
}

export async function loadInversiones(supabase: SupabaseClient): Promise<InversionesData> {
  const [cuentas, filas, tc, saldos, nw, ledger] = await Promise.all([
    supabase.from("cuentas").select("id,nombre,tipo,moneda,activa,titular_id,es_medio_pago,pagadores!cuentas_titular_id_fkey(codigo)").eq("activa", true).in("tipo", ["inversion", "retiro", "cheques"]).eq("es_medio_pago", false).order("nombre"),
    supabase.from("ibkr_estados_mensuales").select("id,cuenta_id,periodo,real_etf,real_acc,real_opc,real_fx,real_bono,nr_etf,nr_acc,nr_opc,nr_fx,nr_bono,div_bruto,div_ret,cupon,cupon_ret,comisiones,int_broker,depositos,nav_efe,nav_acc,nav_opc,nav_bono,nav_dev,nav_final,fuente").order("periodo").range(0, 4999),
    supabase.from("tipos_cambio").select("fecha,moneda,tc_mxn,fuente").eq("moneda", "USD").order("fecha"),
    supabase.from("v_saldo_actual").select("cuenta_id,fecha,saldo,fuente"),
    supabase.from("v_net_worth").select("*").maybeSingle(),
    supabase.from("v_saldo_cuentas").select("id,saldo"),
  ]);
  type CRow = { id: string; nombre: string; tipo: string; moneda: string; pagadores: { codigo: string } | { codigo: string }[] | null };
  const cs = must<CRow[]>(cuentas, "cuentas").map((c) => ({ ...c, titular: (Array.isArray(c.pagadores) ? c.pagadores[0]?.codigo : c.pagadores?.codigo) ?? "" }));
  const sal = must<{ cuenta_id: string; fecha: string; saldo: number; fuente: string }[]>(saldos, "saldos");
  const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
  const ibkrRows = must<Record<string, unknown>[]>(filas, "ibkr").map(num) as unknown as IbkrMes[];
  return {
    cuentasIbkr: cs.filter((c) => c.tipo === "inversion").map((c) => ({ id: c.id, nombre: c.nombre, titular: c.titular })),
    filas: ibkrRows,
    tc: must<TipoCambio[]>(tc, "tipos_cambio").map((t) => ({ ...t, tc_mxn: Number(t.tc_mxn) })),
    retiro: cs.map((c) => {
      if (c.tipo === "cheques") {   // cuenta de cheques sin movimientos: saldo contable (saldo_inicial a la fecha)
        const l = must<{ id: string; saldo: number }[]>(ledger, "saldos").find((x) => x.id === c.id);
        return { id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, titular: c.titular, saldo: l ? Number(l.saldo) : null, fecha: null, fuente: "saldo contable" };
      }
      const s = sal.find((x) => x.cuenta_id === c.id);
      // respaldo: si hay un mes de IBKR más nuevo que el último saldo guardado, manda el NAV de ese mes
      const ult = (ibkrRows as IbkrMes[]).filter((r) => r.cuenta_id === c.id).sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
      const finMes = ult ? new Date(Date.UTC(+ult.periodo.slice(0, 4), +ult.periodo.slice(5, 7), 0)).toISOString().slice(0, 10) : null;
      const usarIbkr = !!ult && (!s || (finMes! > s.fecha));
      return { id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, titular: c.titular,
        saldo: usarIbkr ? Number(ult!.nav_final) : s ? Number(s.saldo) : null,
        fecha: usarIbkr ? finMes : s?.fecha ?? null,
        fuente: usarIbkr ? `IBKR · ${ult!.fuente ?? "estado de cuenta"}` : s?.fuente ?? null };
    }),
    netWorth: nw.data ? (num(nw.data as Record<string, unknown>) as unknown as NetWorth) : null,
    banxico: !!process.env.BANXICO_TOKEN,
    flex: !!(process.env.IBKR_FLEX_TOKEN && process.env.IBKR_FLEX_QUERY_ID),
    flexHoy: !!(process.env.IBKR_FLEX_TOKEN && process.env.IBKR_FLEX_QUERY_MTD),
  };
}

export const UMA_DIARIA = 113.14;   // 2025–2026; actualizar cada febrero

export async function loadFacturacion(supabase: SupabaseClient, anio: number): Promise<FacturacionData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const [{ data: { user } }, cfg, cfdis, sin, rubros, cuentas, ded, mensual, ext, sync, ing, anios] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("app_config").select("rfc_propio").maybeSingle(),
    supabase.from("v_cfdi").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 4999),
    supabase.from("v_movimientos").select("id,fecha,descripcion,grupo,rubro,rubro_id,cuenta,monto_mxn").eq("tipo", "gasto").eq("estado", "real").eq("tiene_cfdi", false)
      .gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 9999),
    supabase.from("rubros").select("id,codigo,nombre,padre_id,clasificacion,emoji,activo,deduccion").eq("naturaleza", "gasto").eq("activo", true).order("orden").order("nombre"),
    supabase.from("cuentas").select("id,nombre,tipo,es_medio_pago").eq("activa", true).eq("es_medio_pago", true).order("nombre"),
    supabase.from("v_deducciones_anual").select("*").eq("anio", anio),
    supabase.from("v_cfdi_mensual").select("*").eq("anio", anio).order("mes"),
    supabase.from("v_facturas_ext").select("*").gte("mes", desde).lte("mes", hasta).order("mes", { ascending: false }),
    supabase.from("drive_sync").select("procesado_en").order("procesado_en", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("v_ingresos").select("tipo,monto,bruto,proyectado").gte("fecha", desde).lte("fecha", hasta).in("tipo", ["sueldo", "bono", "comision"]),
    supabase.from("anios").select("anio").order("anio"),
  ]);
  const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !["serie", "folio", "uuid"].includes(k) ? Number(v) : v]));
  const ingresoAnual = must<{ tipo: string; monto: number; bruto: number | null }[]>(ing, "ingresos").reduce((a, i) => a + Number(i.tipo === "comision" ? i.bruto ?? i.monto : i.monto), 0);
  const listaAnios = must<{ anio: number }[]>(anios, "anios").map((a) => a.anio);
  if (!listaAnios.includes(anio)) listaAnios.push(anio);
  return {
    anio, anios: listaAnios.sort(),
    rfcPropio: cfg.data?.rfc_propio ?? null,
    userId: user?.id ?? "",
    cfdis: must<Record<string, unknown>[]>(cfdis, "cfdi").map(num) as unknown as Cfdi[],
    sinCfdi: must<GastoSinCfdi[]>(sin, "movimientos").map((m) => ({ ...m, monto_mxn: Number(m.monto_mxn) })),
    rubros: must<Rubro[]>(rubros, "rubros"),
    cuentas: must<Cuenta[]>(cuentas, "cuentas"),
    deducciones: must<Record<string, unknown>[]>(ded, "deducciones").map(num) as unknown as DeduccionAnual[],
    mensual: must<Record<string, unknown>[]>(mensual, "cfdi mensual").map(num) as unknown as CfdiMensual[],
    extranjeras: must<FacturaExt[]>(ext, "extranjeras"),
    drive: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.DRIVE_FACTURAS_FOLDER_ID),
    ultimaSync: sync.data?.procesado_en ?? null,
    ingresoAnual, uma: UMA_DIARIA,
  };
}

export async function loadContabilidad(supabase: SupabaseClient, anio: number): Promise<ContabilidadData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !["serie", "folio", "uuid"].includes(k) ? Number(v) : v]));
  const [cfg, mensual, cfdis, cuentas, ibkr, tc, ded, ext, aj, ob, anios, rubros] = await Promise.all([
    supabase.from("app_config").select("rfc_propio").maybeSingle(),
    supabase.from("v_contab_mensual").select("*").order("anio").order("mes"),
    supabase.from("v_cfdi").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha").range(0, 4999),
    supabase.from("cuentas").select("id,nombre,tipo,pagadores!cuentas_titular_id_fkey(codigo)").eq("activa", true).eq("tipo", "inversion").order("nombre"),
    supabase.from("ibkr_estados_mensuales").select("id,cuenta_id,periodo,real_etf,real_acc,real_opc,real_fx,real_bono,nr_etf,nr_acc,nr_opc,nr_fx,nr_bono,div_bruto,div_ret,cupon,cupon_ret,comisiones,int_broker,depositos,nav_efe,nav_acc,nav_opc,nav_bono,nav_dev,nav_final,fuente").order("periodo").range(0, 4999),
    supabase.from("tipos_cambio").select("fecha,moneda,tc_mxn,fuente").eq("moneda", "USD").order("fecha"),
    supabase.from("v_deducciones_anual").select("*").eq("anio", anio),
    supabase.from("v_facturas_ext").select("*").gte("mes", desde).lte("mes", hasta).order("mes"),
    supabase.from("ajustes_fiscales").select("*").order("anio"),
    supabase.from("obligaciones_fiscales").select("*").eq("anio", anio).order("vence"),
    supabase.from("anios").select("anio").order("anio"),
    supabase.from("rubros").select("id,codigo,nombre,padre_id,clasificacion,emoji,activo,deduccion").eq("naturaleza", "gasto"),
  ]);
  type CRow = { id: string; nombre: string; pagadores: { codigo: string } | { codigo: string }[] | null };
  const listaAnios = new Set<number>(must<{ anio: number }[]>(anios, "anios").map((a) => a.anio));
  must<Record<string, unknown>[]>(mensual, "contab").forEach((m) => listaAnios.add(Number(m.anio)));
  must<Record<string, unknown>[]>(ibkr, "ibkr").forEach((r) => listaAnios.add(+String(r.periodo).slice(0, 4)));
  listaAnios.add(anio);
  return {
    anio, anios: [...listaAnios].sort(), rfcPropio: cfg.data?.rfc_propio ?? null,
    mensual: must<Record<string, unknown>[]>(mensual, "contab").map(num) as unknown as ContabMes[],
    cfdis: must<Record<string, unknown>[]>(cfdis, "cfdi").map(num) as unknown as Cfdi[],
    cuentasIbkr: must<CRow[]>(cuentas, "cuentas").map((c) => ({ id: c.id, nombre: c.nombre, titular: (Array.isArray(c.pagadores) ? c.pagadores[0]?.codigo : c.pagadores?.codigo) ?? "" })),
    ibkr: must<Record<string, unknown>[]>(ibkr, "ibkr").map(num) as unknown as IbkrMes[],
    tc: must<TipoCambio[]>(tc, "tipos_cambio").map((t) => ({ ...t, tc_mxn: Number(t.tc_mxn) })),
    deducciones: must<Record<string, unknown>[]>(ded, "deducciones").map(num) as unknown as DeduccionAnual[],
    extranjeras: must<FacturaExt[]>(ext, "extranjeras"),
    ajustes: must<Record<string, unknown>[]>(aj, "ajustes").map(num) as unknown as AjusteFiscal[],
    obligaciones: must<Record<string, unknown>[]>(ob, "obligaciones").map(num) as unknown as Obligacion[],
    rubros: must<Rubro[]>(rubros, "rubros"),
    uma: UMA_DIARIA,
  };
}
