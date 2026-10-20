import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { loadContabilidad } from "@/lib/data";
import { resumenInversiones, perdidasPorAmortizar, tcFn, MESES_LARGO, PERDIDA_ANIOS, yOf, mOf, facturasDeducibles, DED_LABEL } from "@/lib/contab";

export const maxDuration = 60;

const MXN = '"$"#,##0.00;[Red]-"$"#,##0.00', USD = '"US$"#,##0.00;[Red]-"US$"#,##0.00', PCT = "0.0%", TC = "0.0000";
const INK = "FF1F2A1F", HEAD = "FFE9E3D2", BAND = "FFF6F2E8", TOT = "FFDDE6D3", INPUT = "FFFFF4CC";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const anio = Number(new URL(req.url).searchParams.get("anio")) || new Date().getFullYear();
  const d = await loadContabilidad(supabase, anio);
  const fix = tcFn(d.tc);
  const inv = resumenInversiones(d.ibkr, d.cuentasIbkr, d.tc);
  const perdidas = perdidasPorAmortizar(inv, d.ajustes);

  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM CABZ"; wb.created = new Date();

  /* ---------- helpers ---------- */
  const head = (ws: ExcelJS.Worksheet, row: number, cols: string[], widths?: number[]) => {
    const r = ws.getRow(row); r.values = cols; r.font = { bold: true, color: { argb: INK } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; r.alignment = { vertical: "middle", wrapText: true }; r.height = 30;
    cols.forEach((_, i) => { const c = ws.getColumn(i + 1); if (widths?.[i]) c.width = widths[i]; });
    ws.views = [{ state: "frozen", ySplit: row }];
    return r;
  };
  const title = (ws: ExcelJS.Worksheet, t: string, sub?: string) => {
    ws.getCell("A1").value = t; ws.getCell("A1").font = { bold: true, size: 14, color: { argb: INK } };
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = { italic: true, color: { argb: "FF6B6B5E" } }; }
  };
  const totRow = (ws: ExcelJS.Worksheet, row: number, label: string, from: number, to: number, cols: number[], fmts: Record<number, string>) => {
    const r = ws.getRow(row); r.getCell(1).value = label; r.font = { bold: true };
    cols.forEach((c) => { const L = ws.getColumn(c).letter; r.getCell(c).value = { formula: `SUM(${L}${from}:${L}${to})` }; r.getCell(c).numFmt = fmts[c] ?? MXN; });
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOT } };
    return r;
  };
  const band = (ws: ExcelJS.Worksheet, row: number) => { if (row % 2 === 0) ws.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } }; };

  /* ---------- 1. Resumen ---------- */
  const rs = wb.addWorksheet("Resumen");
  title(rs, `Papel de trabajo · ejercicio ${anio}`, `RFC ${d.rfcPropio ?? "—"} · Persona física: actividad empresarial + sueldos y salarios · generado ${new Date().toLocaleDateString("es-MX")}`);
  rs.getColumn(1).width = 46; rs.getColumn(2).width = 20; rs.getColumn(3).width = 60;
  const R: [string, ExcelJS.CellValue, string?][] = [
    ["INGRESOS", null],
    ["Sueldos y salarios brutos", { formula: "Nómina!C15" }, "Suma de percepciones de los CFDI de nómina"],
    ["ISR retenido en nómina", { formula: "Nómina!E15" }],
    ["Honorarios facturados (subtotal)", { formula: "'Actividad e IVA'!B15" }, "Emitidas tipo I menos notas de crédito"],
    ["IVA trasladado", { formula: "'Actividad e IVA'!C15" }],
    ["ISR retenido por clientes", { formula: "'Actividad e IVA'!D15" }],
    ["IVA retenido por clientes", { formula: "'Actividad e IVA'!E15" }],
    ["Dividendos brutos del extranjero (MXN)", { formula: "SUMIF(Inversiones!C:C,\"CABZ\",Inversiones!J:J)" }, "art. 142 fr. V: ISR 10 % definitivo, se acredita retención extranjera"],
    ["Retención extranjera sobre dividendos (MXN)", { formula: "SUMIF(Inversiones!C:C,\"CABZ\",Inversiones!K:K)" }],
    ["Intereses / cupones (MXN)", { formula: "SUMIF(Inversiones!C:C,\"CABZ\",Inversiones!L:L)" }, "art. 143: interés real"],
    ["Ganancia (pérdida) realizada Cap. IV (MXN)", { formula: "SUMIF(Inversiones!C:C,\"CABZ\",Inversiones!I:I)" }, "Enajenación de acciones/ETF/opciones/forex/bonos; ver pestaña Pérdidas"],
    ["Pérdidas de ejercicios anteriores aplicables", { formula: `SUMIFS(Pérdidas!E:E,Pérdidas!A:A,${anio})` }],
    ["", null],
    ["IVA", null],
    ["IVA trasladado del año", { formula: "'Actividad e IVA'!C15" }],
    ["IVA acreditable (gastos facturados, uso no personal)", { formula: "'Actividad e IVA'!G15" }, "El contador valida qué es estrictamente indispensable"],
    ["IVA a cargo (a favor) del año", { formula: "B17-'Actividad e IVA'!E15-B18" }],
    ["", null],
    ["DEDUCCIONES PERSONALES", null],
    ["Médicos y seguros con CFDI", { formula: "Deducciones!B10" }],
    ["Tope general (15 % ingresos o 5 UMA)", { formula: "Deducciones!B11" }],
    ["PPR / AFORE voluntaria aportado", { formula: "Deducciones!B13" }],
    ["Tope PPR (10 % ingresos o 5 UMA)", { formula: "Deducciones!B14" }],
    ["Total deducible", { formula: "MIN(B22,B23)+MIN(B24,B25)" }],
  ];
  R.forEach(([a, b, c], i) => { const r = rs.getRow(4 + i); r.getCell(1).value = a; r.getCell(2).value = b; if (c) r.getCell(3).value = c; r.getCell(2).numFmt = MXN; if (b === null && a) { r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; } });
  rs.getColumn(3).font = { italic: true, color: { argb: "FF6B6B5E" } };

  /* ---------- 2. Actividad e IVA (mensual) ---------- */
  const wa = wb.addWorksheet("Actividad e IVA");
  title(wa, `Actividad empresarial e IVA mensual · ${anio}`, "Emitidas netas de notas de crédito. IVA acreditable = recibidas a tu RFC con uso distinto de D0x/S01.");
  head(wa, 3, ["Mes", "Honorarios (subtotal)", "IVA trasladado", "Ret. ISR", "Ret. IVA", "Gastos facturados (total)", "IVA acreditable", "IVA a cargo (favor)", "Pago provisional ISR estimado", "# emitidas", "# recibidas"], [14, 18, 16, 14, 14, 20, 16, 18, 22, 11, 11]);
  for (let m = 1; m <= 12; m++) {
    const x = d.mensual.find((q) => q.anio === anio && q.mes === m); const r = wa.getRow(3 + m);
    r.values = [MESES_LARGO[m - 1], x?.emitidas_subtotal ?? 0, x?.emitidas_iva ?? 0, x?.emitidas_ret_isr ?? 0, x?.emitidas_ret_iva ?? 0, x?.recibidas_total ?? 0, x?.recibidas_iva_acreditable ?? 0, null, null, x?.emitidas_n ?? 0, x?.recibidas_n ?? 0];
    r.getCell(8).value = { formula: `C${3 + m}-E${3 + m}-G${3 + m}` };
    r.getCell(9).value = { formula: `MAX(0,(SUM($B$4:B${3 + m})-SUM($F$4:F${3 + m}))*Parámetros!$B$4-SUM($D$4:D${3 + m}))` };
    [2, 3, 4, 5, 6, 7, 8, 9].forEach((c) => (r.getCell(c).numFmt = MXN)); band(wa, 3 + m);
  }
  totRow(wa, 15, "Año", 4, 15 - 1, [2, 3, 4, 5, 6, 7, 8, 10, 11], { 10: "0", 11: "0" });
  wa.getCell("I17").value = "Pago provisional estimado: (ingresos acumulados − deducciones acumuladas) × tasa estimada (Parámetros) − retenciones acumuladas. Es una referencia; el contador aplica la tarifa del art. 96."; wa.getCell("I17").font = { italic: true, color: { argb: "FF6B6B5E" } };

  /* ---------- 3. Nómina ---------- */
  const wn = wb.addWorksheet("Nómina");
  title(wn, `Sueldos y salarios · ${anio}`, "De los CFDI de nómina (tipo N) recibidos.");
  head(wn, 3, ["Mes", "# recibos", "Percepciones brutas", "Neto pagado", "ISR retenido"], [14, 11, 20, 18, 16]);
  for (let m = 1; m <= 12; m++) { const x = d.mensual.find((q) => q.anio === anio && q.mes === m); const r = wn.getRow(3 + m); r.values = [MESES_LARGO[m - 1], x?.nomina_n ?? 0, x?.nomina_bruto ?? 0, x?.nomina_neto ?? 0, x?.nomina_isr ?? 0]; [3, 4, 5].forEach((c) => (r.getCell(c).numFmt = MXN)); band(wn, 3 + m); }
  totRow(wn, 15, "Año", 4, 14, [2, 3, 4, 5], { 2: "0" });

  /* ---------- 4. Emitidas / Recibidas (detalle) ---------- */
  const detalle = (nombre: string, tipo: "emitida" | "recibida") => {
    const w = wb.addWorksheet(nombre);
    title(w, `CFDI ${nombre.toLowerCase()} · ${anio}`, "Una fila por comprobante. Tipo: I ingreso · E egreso (nota de crédito) · P pago.");
    head(w, 3, ["Fecha", "Tipo", "UUID", "Serie", "Folio", tipo === "emitida" ? "Receptor" : "Emisor", "RFC", "Concepto", "Uso CFDI", "Subtotal", "IVA", "Ret. ISR", "Ret. IVA", "Total", "Moneda", "TC", "Total MXN", "Forma pago", "Método", "Rubro", "Deducible", "Notas"], [11, 6, 38, 8, 10, 32, 15, 40, 9, 14, 12, 12, 12, 14, 8, 8, 14, 10, 8, 22, 10, 30]);
    const rows = d.cfdis.filter((c) => c.tipo === tipo);
    rows.forEach((c, i) => { const r = w.getRow(4 + i); r.values = [c.fecha, c.tipo_comprobante, c.uuid.toUpperCase(), c.serie, c.folio, tipo === "emitida" ? c.receptor_nombre : c.emisor_nombre, tipo === "emitida" ? c.receptor_rfc : c.emisor_rfc, c.concepto, c.uso_cfdi, c.subtotal, c.iva, c.ret_isr, c.ret_iva, c.total, c.moneda, c.tc ?? 1, null, c.forma_pago, c.metodo_pago, c.rubro ? `${c.grupo} › ${c.rubro}` : "", "", c.notas];
      r.getCell(17).value = { formula: `N${4 + i}*P${4 + i}` }; [10, 11, 12, 13, 14, 17].forEach((k) => (r.getCell(k).numFmt = MXN)); r.getCell(16).numFmt = TC; band(w, 4 + i); });
    if (rows.length) totRow(w, 5 + rows.length, "Total", 4, 3 + rows.length, [10, 11, 12, 13, 14, 17], {});
    w.autoFilter = { from: "A3", to: `V${3 + Math.max(1, rows.length)}` };
  };
  detalle("Emitidas", "emitida"); detalle("Recibidas", "recibida");

  /* ---------- 5. Inversiones por cuenta y año ---------- */
  const wi = wb.addWorksheet("Inversiones");
  title(wi, "Inversiones IBKR · por cuenta y ejercicio", "Flujos en USD convertidos al FIX de cierre de cada mes (pestaña TC). CABZ = tuyas; otros titulares = Akela (papás), se declaran aparte.");
  head(wi, 3, ["Ejercicio", "Cuenta", "Titular", "Meses", "ETFs", "Acciones", "Opciones", "Forex", "Bonos", "Realizada MXN", "Dividendos brutos", "Ret. extranjera", "Cupones", "Ret. cupones", "Comisiones + interés", "Depósitos netos", "NAV cierre USD", "NAV cierre MXN", "No realizada MXN", "Realizada USD"], [10, 22, 9, 7, 14, 14, 14, 14, 14, 16, 16, 14, 14, 12, 18, 16, 16, 16, 16, 14]);
  // columnas: A ejercicio B cuenta C titular D meses E–I por tipo J realizada K div L ret M cupón N retcup O costos P dep Q navUSD R navMXN S nr T realizadaUSD
  inv.sort((a, b) => a.anio - b.anio || a.cuenta.localeCompare(b.cuenta)).forEach((i, k) => {
    const r = wi.getRow(4 + k);
    r.values = [i.anio, i.cuenta, i.titular, i.meses, i.mxn.etf, i.mxn.acc, i.mxn.opc, i.mxn.fx, i.mxn.bono, null, i.mxn.div_bruto, i.mxn.div_ret, i.mxn.cupon, i.mxn.cupon_ret, i.mxn.comisiones + i.mxn.interes, i.mxn.depositos, i.usd.nav, i.mxn.nav, i.mxn.nr, i.usd.realizada];
    r.getCell(10).value = { formula: `SUM(E${4 + k}:I${4 + k})` };
    [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19].forEach((c) => (r.getCell(c).numFmt = MXN)); [17, 20].forEach((c) => (r.getCell(c).numFmt = USD)); band(wi, 4 + k);
  });
  wi.autoFilter = { from: "A3", to: `T${3 + Math.max(1, inv.length)}` };
  // Fix columna C a formato texto para el SUMIF del resumen (titular)
  // Nota: el Resumen usa SUMIF sobre esta hoja sin filtro de año → sumamos solo el ejercicio con SUMIFS
  ["B11", "B12", "B13", "B14"].forEach((cell, idx) => { const col = ["J", "K", "L", "I"][idx]; const cols = { J: "K", K: "L", L: "M", I: "J" } as Record<string, string>; rs.getCell(cell).value = { formula: `SUMIFS(Inversiones!${cols[col]}:${cols[col]},Inversiones!C:C,"CABZ",Inversiones!A:A,${anio})` }; });

  /* ---------- 6. IBKR mensual (crudo) ---------- */
  const wm = wb.addWorksheet("IBKR mensual");
  title(wm, "IBKR · detalle mensual (USD)", "Tal como viene del estado de cuenta / Flex. Base para la pestaña Inversiones.");
  head(wm, 3, ["Periodo", "Cuenta", "Real. ETF", "Real. acciones", "Real. opciones", "Real. forex", "Real. bonos", "NR ETF", "NR acciones", "NR opciones", "NR forex", "NR bonos", "Div. brutos", "Ret. div.", "Cupones", "Ret. cupones", "Comisiones", "Interés bróker", "Depósitos", "NAV efectivo", "NAV acciones", "NAV opciones", "NAV bonos", "NAV devengos", "NAV total", "FIX", "Fuente"], [10, 22, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 14, 9, 30]);
  const nom = (id: string) => d.cuentasIbkr.find((c) => c.id === id)?.nombre.replace(/^IBKR /, "") ?? id;
  d.ibkr.sort((a, b) => a.periodo.localeCompare(b.periodo) || nom(a.cuenta_id).localeCompare(nom(b.cuenta_id))).forEach((r0, k) => {
    const r = wm.getRow(4 + k);
    r.values = [r0.periodo.slice(0, 7), nom(r0.cuenta_id), r0.real_etf, r0.real_acc, r0.real_opc, r0.real_fx, r0.real_bono, r0.nr_etf, r0.nr_acc, r0.nr_opc, r0.nr_fx, r0.nr_bono, r0.div_bruto, r0.div_ret, r0.cupon, r0.cupon_ret, r0.comisiones, r0.int_broker, r0.depositos, r0.nav_efe, r0.nav_acc, r0.nav_opc, r0.nav_bono, r0.nav_dev, r0.nav_final, fix(yOf(r0), mOf(r0)), r0.fuente];
    for (let c = 3; c <= 25; c++) r.getCell(c).numFmt = USD; r.getCell(26).numFmt = TC; band(wm, 4 + k);
  });
  wm.autoFilter = { from: "A3", to: `AA${3 + Math.max(1, d.ibkr.length)}` };

  /* ---------- 7. Pérdidas ---------- */
  const wp = wb.addWorksheet("Pérdidas");
  title(wp, "Pérdidas por amortizar · enajenación de acciones (todas las cuentas)", `Art. 129 LISR: la pérdida de un ejercicio se aplica contra ganancias de los ${PERDIDA_ANIOS} siguientes. Cálculo automático + ajustes manuales (filas 'ajuste').`);
  head(wp, 3, ["Ejercicio", "Concepto", "Resultado realizado MXN", "Pérdida", "Aplicada", "Remanente", "Vence", "Origen"], [10, 50, 22, 16, 16, 16, 9, 9]);
  perdidas.forEach((p, k) => { const r = wp.getRow(4 + k); r.values = [p.anio, p.concepto, p.origen === "ibkr" ? p.resultado : null, p.perdida || null, p.aplicada || null, p.remanente || null, p.vence || null, p.origen]; [3, 4, 5, 6].forEach((c) => (r.getCell(c).numFmt = MXN)); band(wp, 4 + k); if (p.origen === "ajuste") r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }; });
  if (perdidas.length) { const r = wp.getRow(5 + perdidas.length); r.getCell(1).value = "Remanente total"; r.getCell(6).value = { formula: `SUM(F4:F${3 + perdidas.length})` }; r.getCell(6).numFmt = MXN; r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOT } }; }

  /* ---------- 8. Deducciones ---------- */
  const wd = wb.addWorksheet("Deducciones");
  title(wd, `Deducciones personales · ${anio}`, "Art. 151 LISR. Las facturas que las sustentan están en Recibidas (columna Deducible) y en el ZIP.");
  const dd = (k: string) => d.deducciones.find((x) => x.categoria === k);
  const cats: [string, string][] = [["gmm", "Primas de gastos médicos mayores"], ["medico", "Honorarios médicos, dentales, hospital"], ["funeral", "Gastos funerarios"], ["colegiatura", "Colegiaturas"], ["hipoteca", "Intereses reales hipotecarios"], ["donativo", "Donativos"]];
  head(wd, 3, ["Concepto", "Con CFDI (MXN)", "# facturas", "Pagado según Gastos"], [40, 18, 12, 20]);
  cats.forEach(([k, l], i) => { const r = wd.getRow(4 + i); r.values = [l, Number(dd(k)?.con_comprobante ?? 0), Number(dd(k)?.facturas ?? 0), Number(dd(k)?.registrado ?? 0)]; r.getCell(2).numFmt = MXN; r.getCell(4).numFmt = MXN; band(wd, 4 + i); });
  const put = (cell: string, label: string, v: ExcelJS.CellValue, fmt = MXN) => { wd.getCell("A" + cell).value = label; wd.getCell("B" + cell).value = v; wd.getCell("B" + cell).numFmt = fmt; };
  put("10", "Suma médicos y seguros (con CFDI)", { formula: "SUM(B4:B9)" });
  put("11", "Tope general = MIN(15 % × ingresos, 5 UMA anuales)", { formula: "MIN(0.15*B16,5*Parámetros!B6*365)" });
  put("12", "Deducible general", { formula: "MIN(B10,B11)" });
  put("13", "PPR / AFORE voluntaria aportado en el año", Math.max(Number(dd("ppr")?.registrado ?? 0), Number(dd("ppr")?.con_comprobante ?? 0)));
  put("14", "Tope PPR = MIN(10 % × ingresos, 5 UMA anuales)", { formula: "MIN(0.10*B16,5*Parámetros!B6*365)" });
  put("15", "Deducible PPR", { formula: "MIN(B13,B14)" });
  put("16", "Ingresos del año (sueldo bruto + honorarios)", { formula: "Nómina!C15+'Actividad e IVA'!B15" });
  put("17", "TOTAL DEDUCCIONES PERSONALES", { formula: "B12+B15" });
  wd.getRow(17).font = { bold: true }; wd.getRow(17).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOT } };
  wd.getCell("B13").fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
  wd.getCell("C13").value = "← editable: ajústalo con la constancia anual"; wd.getCell("C13").font = { italic: true, color: { argb: "FF6B6B5E" } };

  // detalle factura por factura (lo que sustenta cada deducción)
  const wdd = wb.addWorksheet("Deducciones detalle");
  title(wdd, `Deducciones personales · detalle por factura · ${anio}`, "Recibidas a tu RFC con rubro deducible. Las anuladas por nota de crédito se marcan y no suman. Requisitos: pago no en efectivo, CFDI vigente.");
  head(wdd, 3, ["Categoría (art. 151)", "Fecha", "Emisor", "RFC emisor", "Concepto del CFDI", "Uso CFDI", "Forma de pago", "Rubro en Gastos", "Gasto ligado", "Total MXN", "Anulada", "UUID", "Link Drive", "Archivo XML"], [34, 11, 32, 15, 50, 8, 18, 24, 34, 14, 8, 38, 50, 36]);
  const fp: Record<string, string> = { "01": "Efectivo", "02": "Cheque", "03": "Transferencia", "04": "Tarjeta de crédito", "28": "Tarjeta de débito", "99": "Por definir" };
  const dedF = facturasDeducibles(d.cfdis, d.rubros, d.rfcPropio);
  dedF.forEach(({ cat, c, anulada }, i) => { const r = wdd.getRow(4 + i); r.values = [DED_LABEL[cat] ?? cat, c.fecha, c.emisor_nombre, c.emisor_rfc, c.concepto, c.uso_cfdi, c.forma_pago ? `${c.forma_pago} ${fp[c.forma_pago] ?? ""}` : "", c.rubro ? `${c.grupo} › ${c.rubro}` : "", c.movimiento ? `${c.movimiento_fecha} · ${c.movimiento} · ${c.cuenta}` : "", anulada ? 0 : c.total_mxn, anulada ? "Sí" : "", c.uuid.toUpperCase(), c.link_drive, c.xml_nombre]; r.getCell(10).numFmt = MXN; band(wdd, 4 + i); if (anulada) r.font = { strike: true, color: { argb: "FF888888" } }; });
  if (dedF.length) { const r = wdd.getRow(5 + dedF.length); r.getCell(1).value = "Total"; r.getCell(10).value = { formula: `SUM(J4:J${3 + dedF.length})` }; r.getCell(10).numFmt = MXN; r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOT } }; }
  wdd.autoFilter = { from: "A3", to: `N${3 + Math.max(1, dedF.length)}` };
  // las categorías de la hoja Deducciones toman su total del detalle (SUMIF), no de un número pegado
  cats.forEach(([k], i) => { wd.getCell(`B${4 + i}`).value = { formula: `SUMIF('Deducciones detalle'!A:A,"${(DED_LABEL[k] ?? k).replace(/"/g, '""')}",'Deducciones detalle'!J:J)` }; });

  /* ---------- 9. Extranjeras ---------- */
  const we = wb.addWorksheet("Extranjeras");
  title(we, `Facturas extranjeras (sin CFDI) · ${anio}`, "PDF en Drive; sin IVA acreditable. Monto a capturar por el contador.");
  head(we, 3, ["Mes", "Archivo", "Carpeta", "Link Drive", "Monto", "Moneda", "Notas"], [10, 40, 36, 50, 14, 8, 30]);
  d.extranjeras.forEach((x, i) => { const r = we.getRow(4 + i); r.values = [x.mes?.slice(0, 7), x.nombre, x.carpeta, x.link_drive, null, "USD", null]; r.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }; band(we, 4 + i); });

  /* ---------- 10. Calendario ---------- */
  const wc = wb.addWorksheet("Calendario");
  title(wc, `Calendario fiscal · ${anio}`);
  head(wc, 3, ["Periodo", "Obligación", "Vence", "Estado", "Monto", "Notas"], [12, 48, 12, 12, 14, 40]);
  d.obligaciones.forEach((o, i) => { const r = wc.getRow(4 + i); r.values = [`${MESES_LARGO[o.mes - 1]} ${o.anio}`, o.obligacion, o.vence, o.estado, o.monto, o.notas]; r.getCell(5).numFmt = MXN; band(wc, 4 + i); });

  /* ---------- 11. TC ---------- */
  const wt = wb.addWorksheet("TC");
  title(wt, "Tipo de cambio FIX (Banxico) · cierre de mes", "Usado para convertir los flujos en USD de IBKR.");
  head(wt, 3, ["Mes", "MXN/USD", "Fuente"], [10, 12, 36]);
  d.tc.forEach((t, i) => { const r = wt.getRow(4 + i); r.values = [t.fecha.slice(0, 7), t.tc_mxn, t.fuente]; r.getCell(2).numFmt = TC; band(wt, 4 + i); });

  /* ---------- 12. Parámetros ---------- */
  const wpar = wb.addWorksheet("Parámetros");
  title(wpar, "Parámetros (editables)");
  wpar.getColumn(1).width = 44; wpar.getColumn(2).width = 14; wpar.getColumn(3).width = 50;
  [["Ejercicio", anio, ""], ["Tasa ISR estimada para pagos provisionales", 0.30, "Solo referencia; el contador aplica la tarifa del art. 96"], ["", null, ""], ["UMA diaria", d.uma, "Vigente feb-" + anio], ["Años para amortizar pérdidas (art. 129)", PERDIDA_ANIOS, ""]].forEach(([a, b, c], i) => {
    const r = wpar.getRow(3 + i); r.values = [a, b, c]; if (b !== null && b !== undefined && a) r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }; r.getCell(3).font = { italic: true, color: { argb: "FF6B6B5E" } };
  });
  wpar.getCell("B4").numFmt = PCT;

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Blob([buf as BlobPart]), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Papel_de_trabajo_${anio}.xlsx"` } });
}
