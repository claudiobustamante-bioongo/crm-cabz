/* Parser de CFDI en el servidor (fast-xml-parser), mismo resultado que src/lib/cfdi.ts en el navegador. */
import { XMLParser } from "fast-xml-parser";
import type { CfdiParsed } from "./cfdi";

const num = (v: unknown) => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
type N = Record<string, unknown>;
const strip = (k: string) => k.replace(/^.*:/, "");

/** Quita prefijos de namespace (cfdi:, tfd:, nomina12:) a todo el árbol. */
function clean(n: unknown): unknown {
  if (Array.isArray(n)) return n.map(clean);
  if (n && typeof n === "object") { const o: N = {}; for (const [k, v] of Object.entries(n as N)) o[strip(k)] = clean(v); return o; }
  return n;
}

export function parseCfdiServer(xml: string, rfcPropio: string | null): CfdiParsed {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: false, isArray: (name, _jpath, _leaf, isAttr) => !isAttr && /Concepto$|Traslado$|Retencion$|Deduccion$/.test(name) });   // solo nodos, no atributos (@TipoDeduccion)
  const doc = clean(p.parse(xml)) as N;
  const comp = doc.Comprobante as N | undefined;
  if (!comp) throw new Error("No es un CFDI (sin nodo Comprobante)");
  const emisor = comp.Emisor as N | undefined, receptor = comp.Receptor as N | undefined;
  const compl = comp.Complemento as N | undefined;
  const tfd = (compl?.TimbreFiscalDigital ?? (arr(compl as never) as N[]).find((c) => c?.TimbreFiscalDigital)?.TimbreFiscalDigital) as N | undefined;
  const uuid = String(tfd?.["@UUID"] ?? "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error("CFDI sin timbre (UUID)");
  const tipoC = String(comp["@TipoDeComprobante"] ?? "I");
  const emisorRfc = String(emisor?.["@Rfc"] ?? "").toUpperCase(), receptorRfc = String(receptor?.["@Rfc"] ?? "").toUpperCase();
  const tipo: CfdiParsed["tipo"] = tipoC === "P" ? "pago" : tipoC === "N" ? "nomina" : rfcPropio && emisorRfc === rfcPropio.toUpperCase() ? "emitida" : "recibida";

  let iva = 0, ret_isr = 0, ret_iva = 0, otros = 0;
  const imp = comp.Impuestos as N | undefined;        // impuestos a nivel comprobante (los de Concepto están anidados aparte)
  arr<N>((imp?.Traslados as N | undefined)?.Traslado as never).forEach((t) => { if (t["@Impuesto"] === "002") iva += num(t["@Importe"]); if (t["@Impuesto"] === "003") otros += num(t["@Importe"]); });
  // impuestos locales (implocal): ISH de hoteles, etc.
  const walk = (o: unknown): void => { if (!o || typeof o !== "object") return; Object.entries(o as Record<string, unknown>).forEach(([k, v]) => { const loc = k.replace(/^.*:/, ""); if (loc === "TrasladosLocales") arr<N>(v as never).forEach((t) => { otros += num(t["@Importe"]); }); else if (loc === "RetencionesLocales") arr<N>(v as never).forEach((t) => { otros -= num(t["@Importe"]); }); else if (typeof v === "object") walk(v); }); };
  walk(comp);
  arr<N>((imp?.Retenciones as N | undefined)?.Retencion as never).forEach((t) => { if (t["@Impuesto"] === "001") ret_isr += num(t["@Importe"]); if (t["@Impuesto"] === "002") ret_iva += num(t["@Importe"]); });
  const conceptos: CfdiParsed["conceptos"] = arr<N>((comp.Conceptos as N | undefined)?.Concepto as never).map((c) => ({ descripcion: String(c["@Descripcion"] ?? ""), clave: (c["@ClaveProdServ"] as string | null) ?? null, importe: num(c["@Importe"]) }));
  if (tipoC === "N") {
    const nom = compl?.Nomina as N | undefined;
    ret_isr = arr<N>((nom?.Deducciones as N | undefined)?.Deduccion as never).filter((d) => d["@TipoDeduccion"] === "002").reduce((a, d) => a + num(d["@Importe"]), 0);
    if (nom && !conceptos.length) conceptos.push({ descripcion: "Nómina", clave: null, importe: num(nom["@TotalPercepciones"]) });
  }
  let total = num(comp["@Total"]), subtotal = num(comp["@SubTotal"]), moneda = String(comp["@Moneda"] ?? "MXN"), tc: number | null = comp["@TipoCambio"] != null ? num(comp["@TipoCambio"]) : null;
  let relacionados: string[] | undefined, fechaPago: string | null = null, formaPago = (comp["@FormaPago"] as string) ?? null, metodoPago = (comp["@MetodoPago"] as string) ?? null;
  if (tipoC === "P") {
    // complemento de pago: busca pago20:Pagos en cualquier nivel del Complemento
    const pagosNode = (() => { let f: N | undefined; const w = (o: unknown) => { if (f || !o || typeof o !== "object") return; Object.entries(o as Record<string, unknown>).forEach(([k, v]) => { if (k.replace(/^.*:/, "") === "Pagos") f = v as N; else w(v); }); }; w(compl); return f; })();
    const pagos = arr<N>((pagosNode?.Pago ?? pagosNode?.["pago20:Pago"]) as never);
    total = pagos.reduce((a, e) => a + num(e["@Monto"]), 0);
    iva = 0; const docs: N[] = [];
    pagos.forEach((pg) => { Object.entries(pg).forEach(([k, v]) => { const loc = k.replace(/^.*:/, ""); if (loc === "DoctoRelacionado") docs.push(...arr<N>(v as never)); if (loc === "ImpuestosP") { const w = (o: unknown) => { if (!o || typeof o !== "object") return; Object.entries(o as Record<string, unknown>).forEach(([kk, vv]) => { if (kk.replace(/^.*:/, "") === "TrasladoP") arr<N>(vv as never).forEach((t) => { if (t["@ImpuestoP"] === "002") iva += num(t["@ImporteP"]); }); else w(vv); }); }; w(v); } }); });
    subtotal = Math.round((total - iva) * 100) / 100; ret_isr = 0; ret_iva = 0; otros = 0;
    moneda = String(pagos[0]?.["@MonedaP"] ?? "MXN"); tc = pagos[0]?.["@TipoCambioP"] != null ? num(pagos[0]["@TipoCambioP"]) : null;
    fechaPago = String(pagos[0]?.["@FechaPago"] ?? "").slice(0, 10) || null; formaPago = (pagos[0]?.["@FormaDePagoP"] as string) ?? null; metodoPago = "PUE";
    relacionados = docs.map((d) => String(d["@IdDocumento"] ?? "").toLowerCase()).filter(Boolean);
    conceptos.length = 0; docs.forEach((d) => conceptos.push({ descripcion: `Pago ${d["@NumParcialidad"] ?? "1"} de ${[d["@Serie"], d["@Folio"]].filter(Boolean).join(" ") || "factura"} · saldo ${num(d["@ImpSaldoInsoluto"]).toFixed(2)}`, clave: null, importe: num(d["@ImpPagado"]) }));
  }
  return {
    uuid, tipo, tipo_comprobante: tipoC, relacionados, fecha_pago: fechaPago, fecha: (tipoC === "P" && fechaPago ? fechaPago : String(comp["@Fecha"] ?? "")).slice(0, 10),
    serie: (comp["@Serie"] as string) ?? null, folio: (comp["@Folio"] as string) ?? null,
    emisor_rfc: emisorRfc, emisor_nombre: (emisor?.["@Nombre"] as string) ?? null, receptor_rfc: receptorRfc, receptor_nombre: (receptor?.["@Nombre"] as string) ?? null,
    uso_cfdi: (receptor?.["@UsoCFDI"] as string) ?? null, concepto: (tipoC === "P" ? "Complemento de pago · " : "") + (conceptos.slice(0, 2).map((c) => c.descripcion).join(" · ") || "") || null, conceptos,
    subtotal, descuento: tipoC === "P" ? 0 : num(comp["@Descuento"]), iva, ret_isr, ret_iva, otros_impuestos: Math.round(otros * 100) / 100, total,
    moneda, tc, forma_pago: formaPago, metodo_pago: metodoPago,
  };
}
