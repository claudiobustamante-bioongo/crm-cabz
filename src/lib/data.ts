import type { SupabaseClient } from "@supabase/supabase-js";
import type { AjusteFiscal, AkelaData, AnaliticasData, CfdiIngreso, Deuda, FlujoData, MovAkela, Presupuesto, AkelaRealPlan, Asignacion, Catalogo, LibroAkela, PlanAkela, Cfdi, CfdiMensual, CfdiMini, ContabMes, ContabilidadData, Cuenta, DeduccionAnual, Evento, FacturaExt, FacturacionData, GastoSinCfdi, GastosData, IbkrMes, Ingreso, IngresosData, InversionesData, Movimiento, NetWorth, Obligacion, Rubro, TipoCambio , MetaAhorro, Chequeo} from "./types";

const TIPOS_GASTO = ["gasto", "ahorro", "abono_deuda"];

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

export async function loadGastos(supabase: SupabaseClient, anio: number): Promise<GastosData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const [rubros, cuentas, libros, pagadores, eventos, movimientos, anios, sinLigar, ligadas, saldosV, fechasV, pptos, ingAnio, deudasV, docsV, planAk] = await Promise.all([
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
    supabase.from("v_cfdi").select("uuid,fecha,emisor_nombre,total_mxn,concepto").eq("tipo", "recibida").in("tipo_comprobante", ["I"]).is("movimiento_id", null).gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 1999),
    supabase.from("cfdi").select("movimiento_id").not("movimiento_id", "is", null).range(0, 9999),
    supabase.from("v_saldo_cuentas").select("id,nombre,tipo,moneda,saldo").in("tipo", ["cheques", "tarjeta_credito"]),
    supabase.from("cuentas").select("id,fecha_saldo_inicial").in("tipo", ["cheques", "tarjeta_credito"]),
    supabase.from("presupuestos").select("id,mes,rubro_id,monto,notas,libros(codigo)").gte("mes", desde).lte("mes", hasta),
    supabase.from("v_ingresos").select("fecha,monto_mxn,proyectado,tipo").gte("fecha", desde).lte("fecha", hasta).range(0, 4999),
    supabase.from("v_deudas").select("*"),
    supabase.from("v_docs_por_mov").select("movimiento_id,docs"),
    supabase.from("v_plan_akela").select("rubro_id").eq("anio", anio).not("rubro_id", "is", null),
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
    cfdisSinLigar: must<Record<string, unknown>[]>(sinLigar, "cfdi").map((c) => ({ ...c, total_mxn: Number(c.total_mxn) })) as unknown as CfdiMini[],
    akelaRubroIds: [...new Set(((planAk.data ?? []) as { rubro_id: string }[]).map((r) => r.rubro_id))],
    docsPorMov: ((docsV.data ?? []) as { movimiento_id: string; docs: number }[]).reduce<Record<string, number>>((a, r) => { a[r.movimiento_id] = Number(r.docs); return a; }, {}),
    deudas: ((deudasV.data ?? []) as Record<string, unknown>[]).map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]))) as unknown as Deuda[],
    presupuestos: ((pptos.data ?? []) as unknown as { id: string; mes: string; rubro_id: string; monto: number; notas: string | null; libros: { codigo: string } | { codigo: string }[] | null }[]).map((p) => ({ id: p.id, mes: String(p.mes).slice(0, 7), rubro_id: p.rubro_id, monto: Number(p.monto), notas: p.notas, libro: (Array.isArray(p.libros) ? p.libros[0]?.codigo : p.libros?.codigo) ?? "PERSONAL" })) as Presupuesto[],
    ingresosMes: ((ingAnio.data ?? []) as { fecha: string; monto_mxn: number; proyectado: boolean; tipo: string }[]).filter((i) => !["reembolso", "aportacion_akela"].includes(i.tipo)).map((i) => ({ mes: i.fecha.slice(0, 7), monto_mxn: Number(i.monto_mxn), proyectado: !!i.proyectado, tipo: i.tipo })),
    saldos: ((saldosV.data ?? []) as { id: string; nombre: string; tipo: string; moneda: string; saldo: number }[]).map((x) => ({ ...x, saldo: Number(x.saldo), fecha_saldo_inicial: ((fechasV.data ?? []) as { id: string; fecha_saldo_inicial: string | null }[]).find((f) => f.id === x.id)?.fecha_saldo_inicial ?? null })).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre)),
    facturasPorMov: ((ligadas.data ?? []) as { movimiento_id: string }[]).reduce<Record<string, number>>((a, r) => { a[r.movimiento_id] = (a[r.movimiento_id] ?? 0) + 1; return a; }, {}),
  };
}

export async function loadIngresos(supabase: SupabaseClient, anio: number): Promise<IngresosData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const hoyS = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" }); const mesHoy = hoyS.slice(0, 7);
  const mesesF: string[] = []; for (let i = -2; i <= 4; i++) { const d = new Date(Date.UTC(+hoyS.slice(0, 4), +hoyS.slice(5, 7) - 1 + i, 1)); mesesF.push(d.toISOString().slice(0, 7)); }
  const fDesde = `${mesesF[0]}-01`, fHasta = `${mesesF[mesesF.length - 1]}-31`;
  const [cuentas, pagadores, ingresos, salidas, anios, cfg, libres, { data: { user } }, chq, pptos, gastosHoy, fPptos, fGastos, fAsig, fTransf, fAhorro, fRubros, fTarj, fIng] = await Promise.all([
    supabase.from("cuentas").select("id,nombre,tipo,es_medio_pago").eq("activa", true).order("nombre"),
    supabase.from("pagadores").select("codigo,nombre").eq("activo", true),
    supabase.from("v_ingresos").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 4999),
    supabase.from("v_movimientos").select("fecha,monto_mxn").in("tipo", TIPOS_GASTO).eq("estado", "real")
      .gte("fecha", desde).lte("fecha", hasta).range(0, 19999),
    supabase.from("anios").select("anio").order("anio"),
    supabase.from("app_config").select("rfc_propio").maybeSingle(),
    supabase.from("v_cfdi").select("uuid,fecha,tipo,tipo_comprobante,emisor_nombre,receptor_nombre,total,ret_isr,subtotal,iva,ret_iva,movimiento_id").in("tipo", ["nomina", "emitida"]).is("movimiento_id", null).gte("fecha", desde).lte("fecha", hasta).order("fecha"),
    supabase.auth.getUser(),
    supabase.from("v_saldo_cuentas").select("saldo_mxn,moneda").eq("tipo", "cheques"),
    supabase.from("presupuestos").select("mes,rubro_id,monto").gte("mes", desde).lte("mes", hasta),
    supabase.from("v_movimientos").select("rubro_id,monto_mxn").eq("tipo", "gasto").eq("estado", "real").gte("fecha", `${mesHoy}-01`).lte("fecha", hoyS).range(0, 4999),
    supabase.from("presupuestos").select("id,mes,rubro_id,monto,libros(codigo)").gte("mes", fDesde).lte("mes", fHasta),
    supabase.from("v_movimientos").select("id,fecha,rubro_id,grupo,rubro,monto_mxn,cuenta").eq("tipo", "gasto").eq("estado", "real").gte("fecha", fDesde).lte("fecha", hoyS).range(0, 9999),
    supabase.from("v_asignaciones").select("movimiento_id,libro").eq("tipo", "gasto").gte("fecha", fDesde).lte("fecha", hoyS).range(0, 9999),
    supabase.from("v_movimientos").select("fecha,monto_mxn,cuenta_destino").eq("tipo", "transferencia").eq("estado", "real").gte("fecha", fDesde).lte("fecha", hoyS).range(0, 999),
    supabase.from("v_movimientos").select("fecha,tipo,monto_mxn,rubro").in("tipo", ["ahorro", "abono_deuda"]).eq("estado", "real").gte("fecha", fDesde).lte("fecha", hoyS).range(0, 999),
    supabase.from("rubros").select("id,nombre,padre_id").eq("naturaleza", "gasto"),
    supabase.from("v_saldo_cuentas").select("saldo_mxn,nombre,tipo").in("tipo", ["tarjeta_credito", "cheques"]),
    supabase.from("v_ingresos").select("fecha,tipo,monto_mxn,proyectado").gte("fecha", fDesde).lte("fecha", fHasta).range(0, 999),
  ]);
  const tarjNombres = new Set(((fTarj.data ?? []) as { nombre: string; tipo: string }[]).filter((c) => c.tipo === "tarjeta_credito").map((c) => c.nombre));
  const chqNombres = new Set(((fTarj.data ?? []) as { nombre: string; tipo: string }[]).filter((c) => c.tipo === "cheques").map((c) => c.nombre));
  const libroPorMov = new Map(((fAsig.data ?? []) as { movimiento_id: string; libro: string }[]).map((a) => [a.movimiento_id, a.libro]));
  const flujo: Omit<FlujoData, "ingresos"> = {
    meses: mesesF,
    tarjetasDeuda: -((fTarj.data ?? []) as { saldo_mxn: number; tipo: string }[]).filter((c) => c.tipo === "tarjeta_credito").reduce((a, c) => a + Math.min(0, Number(c.saldo_mxn)), 0),
    pptos: ((fPptos.data ?? []) as unknown as { id: string; mes: string; rubro_id: string; monto: number; libros: { codigo: string } | { codigo: string }[] | null }[]).map((p) => ({ id: p.id, mes: String(p.mes).slice(0, 7), rubro_id: p.rubro_id, monto: Number(p.monto), libro: (Array.isArray(p.libros) ? p.libros[0]?.codigo : p.libros?.codigo) ?? "PERSONAL" })),
    gastos: ((fGastos.data ?? []) as { id: string; fecha: string; rubro_id: string | null; grupo: string; rubro: string; monto_mxn: number; cuenta: string }[]).map((g) => ({ mes: g.fecha.slice(0, 7), rubro_id: g.rubro_id, grupo: g.grupo, rubro: g.rubro, monto_mxn: Number(g.monto_mxn), cuenta_tipo: tarjNombres.has(g.cuenta) ? "tarjeta" : chqNombres.has(g.cuenta) ? "cheques" : "otra", libro: libroPorMov.get(g.id) ?? "PERSONAL" })),
    pagosTarjeta: ((fTransf.data ?? []) as { fecha: string; monto_mxn: number; cuenta_destino: string | null }[]).filter((t) => t.cuenta_destino && tarjNombres.has(t.cuenta_destino)).map((t) => ({ mes: t.fecha.slice(0, 7), monto_mxn: Number(t.monto_mxn) })),
    ahorros: ((fAhorro.data ?? []) as { fecha: string; tipo: string; monto_mxn: number; rubro: string }[]).map((a) => ({ mes: a.fecha.slice(0, 7), tipo: a.tipo, monto_mxn: Number(a.monto_mxn), rubro: a.rubro })),
    rubros: (fRubros.data ?? []) as { id: string; nombre: string; padre_id: string | null }[],
  };
  const ingF = ((fIng.data ?? []) as { fecha: string; tipo: string; monto_mxn: number; proyectado: boolean }[]).filter((i) => !["reembolso", "aportacion_akela"].includes(i.tipo)).map((i) => ({ mes: i.fecha.slice(0, 7), tipo: i.tipo, monto_mxn: Number(i.monto_mxn), proyectado: !!i.proyectado }));
  const pptoMes: Record<string, number> = {}; const pptoRubroHoy: Record<string, number> = {};
  ((pptos.data ?? []) as { mes: string; rubro_id: string; monto: number }[]).forEach((p) => { const k = String(p.mes).slice(0, 7); pptoMes[k] = (pptoMes[k] ?? 0) + Number(p.monto); if (k === mesHoy) pptoRubroHoy[p.rubro_id] = (pptoRubroHoy[p.rubro_id] ?? 0) + Number(p.monto); });
  const realRubroHoy: Record<string, number> = {};
  ((gastosHoy.data ?? []) as { rubro_id: string | null; monto_mxn: number }[]).forEach((g) => { if (g.rubro_id) realRubroHoy[g.rubro_id] = (realRubroHoy[g.rubro_id] ?? 0) + Number(g.monto_mxn); });
  const pptoRestanteHoy = Object.entries(pptoRubroHoy).reduce((a, [r, v]) => a + Math.max(0, v - (realRubroHoy[r] ?? 0)), 0);
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
    rfcPropio: cfg.data?.rfc_propio ?? null, userId: user?.id ?? "",
    cheques: ((chq.data ?? []) as { saldo_mxn: number; moneda: string }[]).filter((c) => c.moneda === "MXN").reduce((a, c) => a + Number(c.saldo_mxn), 0),
    hoy: hoyS, pptoMes, pptoRestanteHoy, flujo: { ...flujo, ingresos: ingF },
    cfdisLibres: ((libres.data ?? []) as Record<string, unknown>[]).map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]))) as unknown as CfdiIngreso[],
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
  const cs = must<CRow[]>(cuentas, "cuentas").map((c) => ({ ...c, titular: (Array.isArray(c.pagadores) ? c.pagadores[0]?.codigo : c.pagadores?.codigo) ?? "" }))
    .filter((c) => c.tipo === "inversion" || c.titular === "CABZ");   // cuentas de terceros (p. ej. "Aportaciones Luis Miguel") no van en saldos
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
  const [{ data: { user } }, cfg, cfdis, sin, rubros, cuentas, libros, ded, mensual, ext, sync, ing, anios] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("app_config").select("rfc_propio").maybeSingle(),
    supabase.from("v_cfdi").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 4999),
    supabase.from("v_movimientos").select("id,fecha,descripcion,grupo,rubro,rubro_id,cuenta,monto_mxn").eq("tipo", "gasto").eq("estado", "real")
      .gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false }).range(0, 9999),
    supabase.from("rubros").select("id,codigo,nombre,padre_id,clasificacion,emoji,activo,deduccion").eq("naturaleza", "gasto").eq("activo", true).order("orden").order("nombre"),
    supabase.from("cuentas").select("id,nombre,tipo,es_medio_pago").eq("activa", true).eq("es_medio_pago", true).order("nombre"),
    supabase.from("libros").select("codigo,nombre").eq("activo", true),
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
    sinCfdi: (() => { const n: Record<string, number> = {}; (must<Cfdi[]>(cfdis, "cfdi") as unknown as { movimiento_id: string | null }[]).forEach((c) => { if (c.movimiento_id) n[c.movimiento_id] = (n[c.movimiento_id] ?? 0) + 1; });
      return must<GastoSinCfdi[]>(sin, "movimientos").map((m) => ({ ...m, monto_mxn: Number(m.monto_mxn), facturas: n[m.id] ?? 0 })); })(),
    rubros: must<Rubro[]>(rubros, "rubros"),
    cuentas: must<Cuenta[]>(cuentas, "cuentas"),
    libros: must<Catalogo[]>(libros, "libros"),
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

export async function loadAkela(supabase: SupabaseClient, anio: number, rol: string | null): Promise<AkelaData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
  const [plan, rp, libro, cuentas, saldos, ibkr, ledger, tc, cfg, anios, rubros, asigAk, movAnio, medios, destinos, depLM, pagadores] = await Promise.all([
    supabase.from("v_plan_akela").select("*").eq("anio", anio).order("linea").order("mes"),
    supabase.from("v_akela_real_vs_plan").select("*").eq("anio", anio),
    supabase.from("v_libro_akela").select("*").gte("fecha", desde).lte("fecha", hasta).order("fecha"),
    supabase.from("cuentas").select("id,nombre,tipo,moneda,pagadores!cuentas_titular_id_fkey(codigo)").eq("activa", true).in("tipo", ["inversion", "fondo"]),
    supabase.from("v_saldo_actual").select("cuenta_id,fecha,saldo,fuente"),
    supabase.from("ibkr_estados_mensuales").select("cuenta_id,periodo,nav_final").order("periodo", { ascending: false }).limit(50),
    supabase.from("v_saldo_cuentas").select("id,saldo"),
    supabase.from("tipos_cambio").select("fecha,tc_mxn").eq("moneda", "USD").order("fecha", { ascending: false }).limit(1),
    supabase.from("app_config").select("akela_nac_papa,akela_nac_mama,akela_rend_real,akela_tc").maybeSingle(),
    supabase.from("anios").select("anio").order("anio"),
    supabase.from("rubros").select("id,nombre,codigo,padre_id").eq("activo", true).eq("naturaleza", "gasto"),
    supabase.from("v_asignaciones").select("movimiento_id,pagador,monto_mxn").eq("libro", "AKELA").eq("tipo", "gasto").gte("fecha", desde).lte("fecha", hasta),
    supabase.from("v_movimientos").select("id,fecha,descripcion,monto_mxn,rubro_id,notas,estado,cuenta").eq("tipo", "gasto").gte("fecha", desde).lte("fecha", hasta),
    supabase.from("cuentas").select("id,nombre").eq("activa", true).eq("es_medio_pago", true).order("nombre"),
    supabase.from("cuentas").select("id,nombre,tipo").eq("activa", true).in("tipo", ["fondo", "cheques"]).order("tipo").order("nombre"),
    supabase.from("v_movimientos").select("id,fecha,monto_mxn,cuenta,cuenta_destino,descripcion").eq("tipo", "transferencia").eq("contraparte", "HAMB").gte("fecha", desde).lte("fecha", hasta).order("fecha"),
    supabase.from("pagadores").select("codigo,nombre").eq("activo", true),
  ]);
  type CRow = { id: string; nombre: string; tipo: string; moneda: string; pagadores: { codigo: string } | { codigo: string }[] | null };
  const cs = must<CRow[]>(cuentas, "cuentas").map((c) => ({ ...c, titular: (Array.isArray(c.pagadores) ? c.pagadores[0]?.codigo : c.pagadores?.codigo) ?? "" })).filter((c) => c.titular !== "CABZ");
  const sal = must<{ cuenta_id: string; fecha: string; saldo: number; fuente: string }[]>(saldos, "saldos");
  const ib = must<{ cuenta_id: string; periodo: string; nav_final: number }[]>(ibkr, "ibkr");
  const led = must<{ id: string; saldo: number }[]>(ledger, "saldos");
  const fondo = cs.map((c) => {
    if (c.tipo === "fondo") { const l = led.find((x) => x.id === c.id); return { nombre: c.nombre, saldo: Number(l?.saldo ?? 0), moneda: c.moneda, fecha: null, fuente: "depósitos − retiros registrados" }; }
    const s = sal.find((x) => x.cuenta_id === c.id); const r = ib.find((x) => x.cuenta_id === c.id);
    const finMes = r ? new Date(Date.UTC(+r.periodo.slice(0, 4), +r.periodo.slice(5, 7), 0)).toISOString().slice(0, 10) : null;
    const usarIbkr = !!r && (!s || finMes! > s.fecha);
    return { nombre: c.nombre.replace(/^IBKR /, ""), saldo: usarIbkr ? Number(r!.nav_final) : s ? Number(s.saldo) : 0, moneda: c.tipo === "inversion" ? "USD" : c.moneda, fecha: usarIbkr ? finMes : s?.fecha ?? null, fuente: usarIbkr ? "IBKR" : s?.fuente ?? null };
  });
  const rubrosAll = must<{ id: string; nombre: string; codigo: string; padre_id: string | null }[]>(rubros, "rubros");
  const akelaId = rubrosAll.find((r) => !r.padre_id && r.nombre === "Akela")?.id;
  const listaAnios = new Set<number>(must<{ anio: number }[]>(anios, "anios").map((a) => a.anio)); listaAnios.add(anio);
  return {
    anio, anios: [...listaAnios].sort(), rol,
    plan: must<Record<string, unknown>[]>(plan, "plan").map(num) as unknown as PlanAkela[],
    realPlan: must<Record<string, unknown>[]>(rp, "real").map(num) as unknown as AkelaRealPlan[],
    libro: must<Record<string, unknown>[]>(libro, "libro").map(num) as unknown as LibroAkela[],
    fondo,
    tcHoy: Number(must<{ tc_mxn: number }[]>(tc, "tc")[0]?.tc_mxn ?? 18.5),
    params: { nac_papa: Number(cfg.data?.akela_nac_papa ?? 1961), nac_mama: Number(cfg.data?.akela_nac_mama ?? 1962), rend_real: Number(cfg.data?.akela_rend_real ?? 0.04), tc: Number(cfg.data?.akela_tc ?? 18.5) },
    rubrosAkela: rubrosAll.filter((r) => r.padre_id === akelaId).map((r) => ({ id: r.id, nombre: r.nombre })),
    rubros: rubrosAll,
    movs: (() => { const ak = new Map((asigAk.data ?? []).map((a) => [a.movimiento_id as string, a])); return ((movAnio.data ?? []) as Record<string, unknown>[]).filter((m) => ak.has(m.id as string)).map((m) => { const a = ak.get(m.id as string)!; return { ...num(m), monto_mxn: Number(a.monto_mxn), pagador: a.pagador as string } as unknown as MovAkela; }).sort((a, b) => a.fecha.localeCompare(b.fecha)); })(),
    medios: (medios.data ?? []) as { id: string; nombre: string }[],
    destinos: ((destinos.data ?? []) as { id: string; nombre: string; tipo: string }[]).filter((c) => !/Luis Miguel/i.test(c.nombre)),
    depLM: ((depLM.data ?? []) as Record<string, unknown>[]).map(num) as unknown as AkelaData["depLM"],
    pagadores: must<Catalogo[]>(pagadores, "pagadores"),
  };
}

/* ---------- Analíticas: 24 meses de flujo, patrimonio, compromisos ---------- */
export async function loadAnaliticas(supabase: SupabaseClient): Promise<AnaliticasData> {
  const hoy = new Date(); const hoyS = hoy.toISOString().slice(0, 10);
  const meses: string[] = []; for (let i = 23; i >= 0; i--) { const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - i, 1)); meses.push(d.toISOString().slice(0, 7)); }
  const desde = `${meses[0]}-01`; const anio = hoy.getFullYear();
  const num = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
  const [ing, gas, otros, fut, deu, ctas, led, sal, nw, nav, sh, tc, rub, plan, libro, fondo] = await Promise.all([
    supabase.from("v_ingresos").select("fecha,mes,tipo,monto_mxn").eq("estado", "real").gte("fecha", desde).lte("fecha", hoyS).range(0, 9999),
    supabase.from("v_asignaciones").select("mes,fecha,tipo,libro,grupo,rubro,rubro_codigo,monto_mxn").eq("tipo", "gasto").eq("estado", "real").eq("pagador", "CABZ").gte("fecha", desde).lte("fecha", hoyS).range(0, 19999),
    supabase.from("v_movimientos").select("mes,fecha,tipo,grupo,rubro,rubro_codigo,monto_mxn").in("tipo", ["ahorro", "abono_deuda"]).eq("estado", "real").gte("fecha", desde).lte("fecha", hoyS).range(0, 9999),
    supabase.from("v_movimientos").select("fecha,mes,estado,descripcion,grupo,monto_mxn,notas").eq("tipo", "gasto").in("estado", ["real", "presupuesto"]).gt("fecha", hoyS).order("fecha").range(0, 4999),
    supabase.from("v_deudas").select("deuda,moneda,saldo_actual,proximo_pago_fecha,proximo_pago_monto,pagos_restantes,fecha_liquidacion,tasa_anual"),
    supabase.from("cuentas").select("id,nombre,tipo,moneda,pagadores!cuentas_titular_id_fkey(codigo,es_titular)").eq("activa", true),
    supabase.from("v_saldo_cuentas").select("id,saldo,saldo_mxn"),
    supabase.from("v_saldo_actual").select("cuenta_id,fecha,saldo"),
    supabase.from("v_net_worth").select("*").maybeSingle(),
    supabase.from("ibkr_estados_mensuales").select("cuenta_id,periodo,nav_final").gte("periodo", meses[0]).order("periodo"),
    supabase.from("saldos_cuenta").select("cuenta_id,fecha,saldo").order("fecha"),
    supabase.from("tipos_cambio").select("fecha,tc_mxn").eq("moneda", "USD").gte("fecha", `${anio - 3}-01-01`).order("fecha"),
    supabase.from("rubros").select("id,codigo,nombre,padre_id,clasificacion"),
    supabase.from("v_plan_akela").select("pagador,mes,monto,anual").eq("anio", anio),
    supabase.from("v_libro_akela").select("mes,concepto,quien,salida_mxn").gte("fecha", `${anio}-01-01`),
    supabase.from("v_saldo_cuentas").select("id,nombre,tipo,saldo_mxn").eq("tipo", "fondo"),
  ]);
  const mesCerrado = hoy.getMonth();   // meses completos del año (0 en enero)
  const ultCerrado = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), 0)).toISOString().slice(0, 7);
  const [metas, ahorros, contab, dedu, oblig, sinRubro, cfdiLibres, tcUlt, ibkrUlt, planSinRubro, ctasCierre, deuVenc] = await Promise.all([
    supabase.from("metas_ahorro").select("*").eq("activa", true).order("orden").order("creado_en"),
    supabase.from("v_movimientos").select("fecha,cuenta_destino,monto_mxn").eq("tipo", "ahorro").eq("estado", "real").gte("fecha", `${anio - 1}-01-01`).lte("fecha", hoyS).range(0, 4999),
    supabase.from("v_contab_mensual").select("*").eq("anio", anio).order("mes"),
    supabase.from("v_deducciones_anual").select("*").eq("anio", anio),
    supabase.from("obligaciones_fiscales").select("obligacion,estado,monto").eq("anio", anio).ilike("obligacion", "Pago provisional%"),
    supabase.from("v_movimientos").select("id", { count: "exact", head: true }).eq("tipo", "gasto").eq("estado", "real").is("rubro", null).gte("fecha", `${anio}-01-01`),
    supabase.from("v_cfdi").select("uuid,total", { count: "exact" }).in("tipo", ["nomina", "emitida"]).is("movimiento_id", null).gte("fecha", `${anio}-01-01`).lte("fecha", hoyS),
    supabase.from("tipos_cambio").select("fecha").eq("moneda", "USD").order("fecha", { ascending: false }).limit(1),
    supabase.from("ibkr_estados_mensuales").select("cuenta_id,periodo").order("periodo", { ascending: false }),
    supabase.from("v_plan_akela").select("linea", { count: "exact" }).eq("anio", anio).eq("pagador", "CABZ").is("rubro_id", null).eq("es_transferencia", false),
    supabase.from("cuentas").select("nombre,tipo,fecha_saldo_inicial").eq("activa", true).in("tipo", ["cheques", "tarjeta_credito"]),
    supabase.from("v_deudas").select("deuda,proximo_pago_fecha,pagos_restantes").lt("proximo_pago_fecha", hoyS).gt("pagos_restantes", 0),
  ]);
  type CRow = { id: string; nombre: string; tipo: string; moneda: string; pagadores: { codigo: string; es_titular: boolean } | { codigo: string; es_titular: boolean }[] | null };
  const mias = must<CRow[]>(ctas, "cuentas").filter((c) => { const p = Array.isArray(c.pagadores) ? c.pagadores[0] : c.pagadores; return p?.es_titular; });
  const ledger = must<{ id: string; saldo: number; saldo_mxn: number }[]>(led, "saldos"), actual = must<{ cuenta_id: string; fecha: string; saldo: number }[]>(sal, "saldo_actual");
  const tcs = must<{ fecha: string; tc_mxn: number }[]>(tc, "tc").map((t) => ({ fecha: t.fecha, tc_mxn: Number(t.tc_mxn) }));
  const tcHoy = tcs[tcs.length - 1]?.tc_mxn ?? 18.5;
  const rubros = must<{ id: string; codigo: string; nombre: string; padre_id: string | null; clasificacion: string | null }[]>(rub, "rubros");
  const clsDe = (codigo: string) => { const r = rubros.find((x) => x.codigo === codigo); const p = r?.padre_id ? rubros.find((x) => x.id === r.padre_id) : null; return r?.clasificacion ?? p?.clasificacion ?? null; };
  const cuentas = mias.map((c) => {
    if (c.tipo === "inversion" || c.tipo === "retiro") { const s = actual.find((x) => x.cuenta_id === c.id); const v = s ? Number(s.saldo) : 0; return { id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, saldo: v, saldo_mxn: c.moneda === "USD" ? v * tcHoy : v, fecha: s?.fecha ?? null }; }
    const l = ledger.find((x) => x.id === c.id); return { id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, saldo: Number(l?.saldo ?? 0), saldo_mxn: Number(l?.saldo_mxn ?? 0), fecha: null };
  }).filter((c) => c.saldo_mxn !== 0 || c.tipo === "cheques");
  const miasIds = new Set(mias.map((c) => c.id));
  const planRows = (plan.data ?? []) as { pagador: string; mes: number; monto: number; anual: boolean }[];
  const mesAct = hoy.getMonth() + 1;
  const planAnual = planRows.filter((p) => p.pagador === "CABZ").reduce((a, p) => a + Number(p.monto), 0);
  const planYtd = planRows.filter((p) => p.pagador === "CABZ").reduce((a, p) => a + (p.anual ? (Number(p.monto) * mesAct) / 12 : p.mes <= mesAct ? Number(p.monto) : 0), 0);
  const realYtd = ((libro.data ?? []) as { concepto: string; quien: string | null; salida_mxn: number }[]).filter((x) => x.concepto === "gasto" && x.quien === "CABZ").reduce((a, x) => a + Number(x.salida_mxn), 0);
  const mesK = (r: Record<string, unknown>) => ({ ...r, mes: String(r.fecha ?? r.mes ?? "").slice(0, 7) });   // las vistas devuelven mes como date
  return {
    hoy: hoyS, meses,
    ingresos: ((ing.data ?? []) as Record<string, unknown>[]).map(num).map(mesK) as unknown as AnaliticasData["ingresos"],
    gastos: [...((gas.data ?? []) as Record<string, unknown>[]).map(num).map(mesK), ...((otros.data ?? []) as Record<string, unknown>[]).map(num).map(mesK).map((o) => ({ ...o, libro: "PERSONAL" }))].map((g) => { const x = g as unknown as Omit<AnaliticasData["gastos"][number], "clasificacion">; return { ...x, grupo: x.grupo ?? "Otros", rubro: x.rubro ?? "", rubro_codigo: x.rubro_codigo ?? "", clasificacion: clsDe(x.rubro_codigo ?? "") }; }),
    futuros: ((fut.data ?? []) as Record<string, unknown>[]).map(num).map(mesK).map((f) => ({ ...f, libro: null })) as unknown as AnaliticasData["futuros"],
    deudas: ((deu.data ?? []) as Record<string, unknown>[]).map(num) as unknown as AnaliticasData["deudas"],
    cuentas,
    netWorth: nw.data ? (num(nw.data as Record<string, unknown>) as unknown as NetWorth) : null,
    navHist: ((nav.data ?? []) as { cuenta_id: string; periodo: string; nav_final: number }[]).filter((r) => miasIds.has(r.cuenta_id)).map((r) => ({ ...r, nav_final: Number(r.nav_final) })),
    saldosHist: ((sh.data ?? []) as { cuenta_id: string; fecha: string; saldo: number }[]).filter((r) => miasIds.has(r.cuenta_id)).map((r) => ({ ...r, saldo: Number(r.saldo) })),
    tc: tcs,
    akela: planAnual ? { plan_ytd: planYtd, real_ytd: realYtd, plan_anual: planAnual, fondo_mxn: ((fondo.data ?? []) as { saldo_mxn: number }[]).reduce((a, f) => a + Number(f.saldo_mxn), 0) } : null,
    metas: ((metas.data ?? []) as Record<string, unknown>[]).map(num) as unknown as MetaAhorro[],
    ahorros: ((ahorros.data ?? []) as { fecha: string; cuenta_destino: string | null; monto_mxn: number }[]).map((a) => ({ ...a, mes: a.fecha.slice(0, 7), monto_mxn: Number(a.monto_mxn) })),
    cuentasDestino: mias.filter((c) => ["inversion", "retiro", "fondo", "ahorro"].includes(c.tipo)).map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo })),
    fiscal: {
      anio, mes_cerrado: mesCerrado,
      contab: ((contab.data ?? []) as Record<string, unknown>[]).map(num) as unknown as ContabMes[],
      deducciones: ((dedu.data ?? []) as Record<string, unknown>[]).map(num) as unknown as DeduccionAnual[],
      pagos_provisionales: ((oblig.data ?? []) as { estado: string; monto: number | null }[]).filter((o) => o.estado === "pagada").reduce((a, o) => a + Number(o.monto ?? 0), 0),
    },
    integridad: integridad({
      hoy, hoyS, anio, ultCerrado, sinRubro: sinRubro.count ?? 0, cfdiLibres: cfdiLibres.count ?? 0, cfdiLibresMonto: ((cfdiLibres.data ?? []) as { total: number }[]).reduce((a, c) => a + Number(c.total), 0),
      tcUlt: (tcUlt.data?.[0] as { fecha: string } | undefined)?.fecha ?? null,
      ibkr: ((ibkrUlt.data ?? []) as { cuenta_id: string; periodo: string }[]).filter((r) => miasIds.has(r.cuenta_id)), cuentasInv: mias.filter((c) => c.tipo === "inversion").map((c) => ({ id: c.id, nombre: c.nombre })),
      planSinRubro: planSinRubro.count ?? 0, ctasCierre: (ctasCierre.data ?? []) as { nombre: string; tipo: string; fecha_saldo_inicial: string | null }[],
      deudasVencidas: ((deuVenc.data ?? []) as { deuda: string; proximo_pago_fecha: string }[]),
      cuentas, netWorth: nw.data ? Number((nw.data as { neto_mxn: number }).neto_mxn) : null, errores: [metas, ahorros, contab, dedu, oblig].filter((r) => r.error).map((r) => r.error!.message),
    }),
  };
}

/** Cuadres automáticos: lo que suele desviarse en silencio. */
function integridad(x: { hoy: Date; hoyS: string; anio: number; ultCerrado: string; sinRubro: number; cfdiLibres: number; cfdiLibresMonto: number; tcUlt: string | null; ibkr: { cuenta_id: string; periodo: string }[]; cuentasInv: { id: string; nombre: string }[]; planSinRubro: number; ctasCierre: { nombre: string; tipo: string; fecha_saldo_inicial: string | null }[]; deudasVencidas: { deuda: string; proximo_pago_fecha: string }[]; cuentas: { nombre: string; tipo: string; saldo_mxn: number }[]; netWorth: number | null; errores: string[] }): Chequeo[] {
  const out: Chequeo[] = [];
  const dias = (f: string | null) => f ? Math.round((x.hoy.getTime() - new Date(f + "T00:00:00Z").getTime()) / 86400000) : 9999;
  x.errores.forEach((e) => out.push({ nivel: "error", titulo: "Consulta fallida", detalle: e + (/metas_ahorro/.test(e) ? " (corre 47_metas_ahorro.sql)" : "") }));
  // 1. cierres de saldo recientes (cheques y tarjetas)
  x.ctasCierre.forEach((c) => { const d = dias(c.fecha_saldo_inicial); if (d > 45) out.push({ nivel: d > 90 ? "error" : "aviso", titulo: `${c.nombre}: cierre de saldo de hace ${d === 9999 ? "nunca" : d + " días"}`, detalle: "Registra el saldo real en Gastos → Cierre de saldos para que la liquidez sea confiable.", href: "/gastos" }); });
  // 2. tarjetas con saldo positivo o cheques negativo = algo se registró al revés
  x.cuentas.filter((c) => c.tipo === "tarjeta_credito" && c.saldo_mxn > 1).forEach((c) => out.push({ nivel: "aviso", titulo: `${c.nombre} tiene saldo a favor`, detalle: "Un pago de tarjeta mayor al gasto registrado: faltan gastos o el pago se duplicó.", href: "/gastos" }));
  x.cuentas.filter((c) => c.tipo === "cheques" && c.saldo_mxn < 0).forEach((c) => out.push({ nivel: "error", titulo: `${c.nombre} en negativo`, detalle: "Hay salidas registradas que el saldo no cubre: falta un ingreso o un cierre de saldo.", href: "/gastos" }));
  // 3. gastos sin rubro
  if (x.sinRubro > 0) out.push({ nivel: "aviso", titulo: `${x.sinRubro} gasto${x.sinRubro === 1 ? "" : "s"} sin rubro en ${x.anio}`, detalle: "No entran a las analíticas por rubro ni a la caja del mes.", href: "/gastos" });
  // 4. CFDI de ingreso sin ligar
  if (x.cfdiLibres > 0) out.push({ nivel: x.cfdiLibresMonto > 50000 ? "error" : "aviso", titulo: `${x.cfdiLibres} CFDI de nómina/honorarios sin ligar a un ingreso`, detalle: `Suman ${Math.round(x.cfdiLibresMonto).toLocaleString("es-MX")}: el ingreso no está registrado o no se ligó (doble comprobación).`, href: "/ingresos" });
  // 5. tipo de cambio
  const dtc = dias(x.tcUlt); if (dtc > 5) out.push({ nivel: dtc > 15 ? "error" : "aviso", titulo: `Tipo de cambio de hace ${dtc} días`, detalle: "El cron de Banxico no está corriendo; los saldos en USD se valúan viejos.", href: "/inversiones" });
  // 6. IBKR: falta el estado del último mes cerrado
  x.cuentasInv.forEach((c) => { const ult = x.ibkr.find((r) => r.cuenta_id === c.id)?.periodo?.slice(0, 7) ?? null; if (!ult || ult < x.ultCerrado) out.push({ nivel: "aviso", titulo: `${c.nombre}: último estado IBKR ${ult ?? "—"}`, detalle: `Falta ${x.ultCerrado}. Sube el Flex mensual o revisa el cron.`, href: "/inversiones" }); });
  // 7. Akela: líneas del plan sin rubro (el real no se concilia)
  if (x.planSinRubro > 0) out.push({ nivel: "aviso", titulo: `Akela ${x.anio}: ${x.planSinRubro} línea${x.planSinRubro === 1 ? "" : "s"} del plan sin subrubro`, detalle: "Los gastos reales no se cruzan con esas líneas; asígnales subrubro en la cuadrícula.", href: "/akela" });
  // 8. deudas con pago vencido
  x.deudasVencidas.forEach((d) => out.push({ nivel: "aviso", titulo: `${d.deuda}: pago del ${d.proximo_pago_fecha} sin registrar`, detalle: "Registra el pago o ajusta el saldo en Gastos → Deudas.", href: "/gastos" }));
  // 9. net worth presente
  if (x.netWorth === null) out.push({ nivel: "error", titulo: "v_net_worth no responde", detalle: "El patrimonio no se calcula; revisa las vistas (04/44)." });
  if (!out.length) out.push({ nivel: "ok", titulo: "Todo cuadra", detalle: "Cierres recientes, CFDI ligados, tipo de cambio al día, IBKR completo." });
  return out.sort((a, b) => ["error", "aviso", "ok"].indexOf(a.nivel) - ["error", "aviso", "ok"].indexOf(b.nivel));
}
