/* Flex Web Service de IBKR → mismas filas que el CSV mensual (IbkrRow), sin subir archivos.
   Secciones que debe traer la Flex Query (formato XML, periodo de UN mes):
   · Account Information · Cash Report · Realized & Unrealized Performance Summary (in Base)
   · Open Positions (summary, in Base) · Change in NAV  (o Equity Summary in Base si existe) */
import { XMLParser } from "fast-xml-parser";
import { classify, type IbkrRow } from "./ibkr";

const FLEX = "https://ndcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService";
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : 0; };
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FlexError extends Error {}

/** Pide el reporte y espera a que IBKR lo genere. Devuelve el XML crudo. */
export async function fetchFlex(token: string, queryId: string): Promise<string> {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const r1 = await fetch(`${FLEX}.SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`, { cache: "no-store" });
  const x1 = p.parse(await r1.text());
  const s1 = x1?.FlexStatementResponse;
  if (!s1 || s1.Status !== "Success") throw new FlexError(`IBKR: ${s1?.ErrorMessage ?? "sin respuesta"} (código ${s1?.ErrorCode ?? "?"})`);
  const ref = String(s1.ReferenceCode);
  for (let i = 0; i < 10; i++) {
    await sleep(i === 0 ? 1500 : 4000);
    const r2 = await fetch(`${FLEX}.GetStatement?q=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}&v=3`, { cache: "no-store" });
    const txt = await r2.text();
    if (txt.includes("<FlexQueryResponse")) return txt;
    const x2 = p.parse(txt)?.FlexStatementResponse;
    const code = String(x2?.ErrorCode ?? "");
    if (code && !["1019", "1021"].includes(code)) throw new FlexError(`IBKR: ${x2?.ErrorMessage ?? "error"} (código ${code})`);
  }
  throw new FlexError("IBKR tardó demasiado en generar el reporte; inténtalo en un minuto.");
}

export interface FlexRow extends IbkrRow { cuenta: string; year: number; mes: number; desde: string; hasta: string; parcial: boolean }

/** Convierte el XML de Flex en filas mensuales (una por cuenta). */
export function parseFlex(xml: string): FlexRow[] {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", isArray: (name) => ["FlexStatement", "FIFOPerformanceSummaryUnderlying", "CashReportCurrency", "EquitySummaryByReportDateInBase", "ChangeInNAV", "OpenPosition"].includes(name) });
  const doc = p.parse(xml);
  const stmts = arr<Record<string, unknown>>(doc?.FlexQueryResponse?.FlexStatements?.FlexStatement);
  if (!stmts.length) throw new FlexError("El reporte no trae FlexStatement: revisa la query.");
  return stmts.map((s) => {
    const desde = String(s.fromDate ?? ""), hasta = String(s.toDate ?? "");
    const y = +desde.slice(0, 4), m = +desde.slice(4, 6);
    if (!y || !m) throw new FlexError("El reporte no trae fechas (fromDate/toDate).");
    if (hasta.slice(0, 6) !== desde.slice(0, 6)) throw new FlexError(`El periodo ${desde}–${hasta} abarca más de un mes: la query debe ser de un mes (Last Month o Month to Date).`);
    const r: FlexRow = { cuenta: String(s.accountId ?? ""), year: y, mes: m, desde, hasta, parcial: false,
      re: 0, ra: 0, ro: 0, rf: 0, rb: 0, sne: 0, sna: 0, sno: 0, snf: 0, snb: 0, db: 0, dr: 0, cb: 0, cr: 0, cm: 0, ib: 0, dep: 0,
      nav_efe: 0, nav_acc: 0, nav_opc: 0, nav_bono: 0, nav_dev: 0, nav_tot: 0 };
    const finMes = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10).replace(/-/g, "");
    r.parcial = hasta < finMes;

    // Realizada / no realizada por clase (FIFO, en moneda base)
    const realK: Record<string, keyof IbkrRow> = { etfs: "re", acciones: "ra", opciones: "ro", forex: "rf", bonos: "rb" };
    const nrK: Record<string, keyof IbkrRow> = { etfs: "sne", acciones: "sna", opciones: "sno", forex: "snf", bonos: "snb" };
    const perf = s.FIFOPerformanceSummaryInBase as Record<string, unknown> | undefined;
    arr<Record<string, unknown>>(perf?.FIFOPerformanceSummaryUnderlying as never).forEach((u) => {
      const sym = String(u.symbol ?? "").trim(); if (!sym) return;
      const cat = String(u.assetCategory ?? "").toUpperCase();
      const c = cat === "OPT" || cat === "FOP" ? "opciones" : cat === "CASH" ? "forex" : cat === "BOND" ? "bonos" : cat === "STK" ? classify(sym, "Acciones") : null;
      if (!c || !realK[c]) return;
      const real = u.totalRealizedPnl != null ? num(u.totalRealizedPnl) : num(u.realizedSTProfit) + num(u.realizedSTLoss) + num(u.realizedLTProfit) + num(u.realizedLTLoss);
      const nr = u.totalUnrealizedPnl != null ? num(u.totalUnrealizedPnl) : num(u.unrealizedProfit) + num(u.unrealizedLoss);
      (r as unknown as Record<string, number>)[realK[c]] += real; (r as unknown as Record<string, number>)[nrK[c]] += nr;
    });

    // Informe de efectivo (resumen en moneda base)
    const cash = arr<Record<string, unknown>>((s.CashReport as Record<string, unknown> | undefined)?.CashReportCurrency as never)
      .find((c) => String(c.currency ?? "").toUpperCase() === "BASE_SUMMARY") ?? arr<Record<string, unknown>>((s.CashReport as Record<string, unknown> | undefined)?.CashReportCurrency as never)[0];
    if (cash) {
      r.cm = num(cash.commissions) + num(cash.otherFees);
      r.ib = num(cash.brokerInterest);
      r.cb = num(cash.bondInterest);
      r.db = num(cash.dividends) + num(cash.paymentInLieu);
      const wh = num(cash.withholdingTax); r.dr = wh < 0 ? -wh : 0;
      r.dep = num(cash.deposits) + num(cash.withdrawals) + num(cash.accountTransfers) + num(cash.internalTransfers);
    }

    // NAV por clase. Preferencia: Equity Summary in Base (último día). Si no viene:
    // efectivo = endingCash del Cash Report, acciones/opciones/bonos = Open Positions (valor en base),
    // total = Change in NAV (endingValue), devengos = lo que falta para cuadrar.
    const eq = arr<Record<string, unknown>>((s.EquitySummaryInBase as Record<string, unknown> | undefined)?.EquitySummaryByReportDateInBase as never)
      .sort((a, b) => String(a.reportDate).localeCompare(String(b.reportDate))).at(-1);
    const nav = arr<Record<string, unknown>>(s.ChangeInNAV as never)[0];
    if (eq) {
      r.nav_efe = num(eq.cash); r.nav_acc = num(eq.stock); r.nav_opc = num(eq.options); r.nav_bono = num(eq.bonds);
      r.nav_dev = num(eq.dividendAccruals) + num(eq.interestAccruals); r.nav_tot = num(eq.total);
    } else {
      r.nav_tot = num(nav?.endingValue);
      r.nav_efe = num(cash?.endingCash);
      arr<Record<string, unknown>>((s.OpenPositions as Record<string, unknown> | undefined)?.OpenPosition as never).forEach((o) => {
        if (String(o.levelOfDetail ?? "SUMMARY").toUpperCase() === "LOT") return;   // evita duplicar lotes
        const cat = String(o.assetCategory ?? "").toUpperCase();
        const v = o.positionValueInBase != null ? num(o.positionValueInBase) : num(o.positionValue) * (num(o.fxRateToBase) || 1);
        if (cat === "STK") r.nav_acc += v; else if (cat === "OPT" || cat === "FOP") r.nav_opc += v; else if (cat === "BOND") r.nav_bono += v;
      });
      if (r.nav_tot) r.nav_dev = +(r.nav_tot - r.nav_efe - r.nav_acc - r.nav_opc - r.nav_bono).toFixed(2);
      else r.nav_tot = r.nav_efe + r.nav_acc + r.nav_opc + r.nav_bono;
    }
    (["re", "ra", "ro", "rf", "rb", "sne", "sna", "sno", "snf", "snb", "db", "dr", "cb", "cr", "cm", "ib", "dep", "nav_efe", "nav_acc", "nav_opc", "nav_bono", "nav_dev", "nav_tot"] as const)
      .forEach((k) => { r[k] = +r[k].toFixed(2); });
    return r;
  });
}
