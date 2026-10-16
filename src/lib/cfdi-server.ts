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
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: false, isArray: (name) => /Concepto$|Traslado$|Retencion$|Deduccion$/.test(name) });
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
  const tipo: CfdiParsed["tipo"] = tipoC === "N" ? "nomina" : rfcPropio && emisorRfc === rfcPropio.toUpperCase() ? "emitida" : "recibida";

  let iva = 0, ret_isr = 0, ret_iva = 0;
  const imp = comp.Impuestos as N | undefined;        // impuestos a nivel comprobante (los de Concepto están anidados aparte)
  arr<N>((imp?.Traslados as N | undefined)?.Traslado as never).forEach((t) => { if (t["@Impuesto"] === "002") iva += num(t["@Importe"]); });
  arr<N>((imp?.Retenciones as N | undefined)?.Retencion as never).forEach((t) => { if (t["@Impuesto"] === "001") ret_isr += num(t["@Importe"]); if (t["@Impuesto"] === "002") ret_iva += num(t["@Importe"]); });
  const conceptos: CfdiParsed["conceptos"] = arr<N>((comp.Conceptos as N | undefined)?.Concepto as never).map((c) => ({ descripcion: String(c["@Descripcion"] ?? ""), clave: (c["@ClaveProdServ"] as string | null) ?? null, importe: num(c["@Importe"]) }));
  if (tipoC === "N") {
    const nom = compl?.Nomina as N | undefined;
    ret_isr = arr<N>((nom?.Deducciones as N | undefined)?.Deduccion as never).filter((d) => d["@TipoDeduccion"] === "002").reduce((a, d) => a + num(d["@Importe"]), 0);
    if (nom && !conceptos.length) conceptos.push({ descripcion: "Nómina", clave: null, importe: num(nom["@TotalPercepciones"]) });
  }
  return {
    uuid, tipo, tipo_comprobante: tipoC, fecha: String(comp["@Fecha"] ?? "").slice(0, 10),
    serie: (comp["@Serie"] as string) ?? null, folio: (comp["@Folio"] as string) ?? null,
    emisor_rfc: emisorRfc, emisor_nombre: (emisor?.["@Nombre"] as string) ?? null, receptor_rfc: receptorRfc, receptor_nombre: (receptor?.["@Nombre"] as string) ?? null,
    uso_cfdi: (receptor?.["@UsoCFDI"] as string) ?? null, concepto: conceptos.slice(0, 2).map((c) => c.descripcion).join(" · ") || null, conceptos,
    subtotal: num(comp["@SubTotal"]), descuento: num(comp["@Descuento"]), iva, ret_isr, ret_iva, total: num(comp["@Total"]),
    moneda: String(comp["@Moneda"] ?? "MXN"), tc: comp["@TipoCambio"] != null ? num(comp["@TipoCambio"]) : null,
    forma_pago: (comp["@FormaPago"] as string) ?? null, metodo_pago: (comp["@MetodoPago"] as string) ?? null,
  };
}
