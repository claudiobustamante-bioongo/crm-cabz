/* Parser de CFDI 3.3 / 4.0 (XML del SAT) en el navegador. Sin dependencias. */
export interface CfdiParsed {
  uuid: string;
  tipo: "emitida" | "recibida" | "nomina";
  tipo_comprobante: string;          // I · E · N · P · T
  fecha: string;                     // YYYY-MM-DD
  serie: string | null; folio: string | null;
  emisor_rfc: string; emisor_nombre: string | null;
  receptor_rfc: string; receptor_nombre: string | null;
  uso_cfdi: string | null;
  concepto: string | null;
  conceptos: { descripcion: string; clave: string | null; importe: number }[];
  subtotal: number; descuento: number; iva: number; ret_isr: number; ret_iva: number; otros_impuestos: number; total: number;
  moneda: string; tc: number | null;
  forma_pago: string | null; metodo_pago: string | null;
}

const num = (v: string | null | undefined) => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };

export function parseCfdi(xml: string, rfcPropio: string | null): CfdiParsed {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido");
  const all = Array.from(doc.getElementsByTagName("*"));
  const first = (name: string) => all.find((e) => e.localName === name) ?? null;
  const comp = first("Comprobante");
  if (!comp) throw new Error("No es un CFDI (sin nodo Comprobante)");
  const emisor = first("Emisor"), receptor = first("Receptor"), tfd = first("TimbreFiscalDigital");
  const uuid = (tfd?.getAttribute("UUID") ?? "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error("CFDI sin timbre (UUID)");

  // Impuestos a nivel comprobante (no los de cada concepto, que van anidados bajo Concepto)
  const compImp = Array.from(comp.children).find((e) => e.localName === "Impuestos");
  let iva = 0, ret_isr = 0, ret_iva = 0, otros = 0;
  if (compImp) {
    Array.from(compImp.getElementsByTagName("*")).forEach((e) => {
      if (e.localName === "Traslado" && e.getAttribute("Impuesto") === "002") iva += num(e.getAttribute("Importe"));
      if (e.localName === "Traslado" && e.getAttribute("Impuesto") === "003") otros += num(e.getAttribute("Importe"));   // IEPS
      if (e.localName === "Retencion") {
        if (e.getAttribute("Impuesto") === "001") ret_isr += num(e.getAttribute("Importe"));
        if (e.getAttribute("Impuesto") === "002") ret_iva += num(e.getAttribute("Importe"));
      }
    });
  }
  // impuestos locales (complemento implocal): ISH de hoteles, etc.
  all.forEach((e) => { if (e.localName === "TrasladosLocales") otros += num(e.getAttribute("Importe")); if (e.localName === "RetencionesLocales") otros -= num(e.getAttribute("Importe")); });
  const tipoC = comp.getAttribute("TipoDeComprobante") ?? "I";
  const emisorRfc = (emisor?.getAttribute("Rfc") ?? "").toUpperCase();
  const receptorRfc = (receptor?.getAttribute("Rfc") ?? "").toUpperCase();
  const tipo: CfdiParsed["tipo"] = tipoC === "N" ? "nomina" : rfcPropio && emisorRfc === rfcPropio.toUpperCase() ? "emitida" : "recibida";
  const conceptos = all.filter((e) => e.localName === "Concepto").map((e) => ({
    descripcion: e.getAttribute("Descripcion") ?? "", clave: e.getAttribute("ClaveProdServ"), importe: num(e.getAttribute("Importe")),
  }));
  // nómina: el total es lo pagado; el ISR retenido viene en el complemento
  if (tipoC === "N") {
    const nom = first("Nomina");
    const ded = all.find((e) => e.localName === "Deducciones");
    ret_isr = Array.from(ded?.getElementsByTagName("*") ?? []).filter((e) => e.localName === "Deduccion" && e.getAttribute("TipoDeduccion") === "002").reduce((a, e) => a + num(e.getAttribute("Importe")), 0);
    if (nom && !conceptos.length) conceptos.push({ descripcion: "Nómina", clave: null, importe: num(nom.getAttribute("TotalPercepciones")) });
  }
  return {
    uuid, tipo, tipo_comprobante: tipoC,
    fecha: (comp.getAttribute("Fecha") ?? "").slice(0, 10),
    serie: comp.getAttribute("Serie"), folio: comp.getAttribute("Folio"),
    emisor_rfc: emisorRfc, emisor_nombre: emisor?.getAttribute("Nombre") ?? null,
    receptor_rfc: receptorRfc, receptor_nombre: receptor?.getAttribute("Nombre") ?? null,
    uso_cfdi: receptor?.getAttribute("UsoCFDI") ?? null,
    concepto: conceptos.slice(0, 2).map((c) => c.descripcion).join(" · ") || null,
    conceptos,
    subtotal: num(comp.getAttribute("SubTotal")), descuento: num(comp.getAttribute("Descuento")),
    iva, ret_isr, ret_iva, otros_impuestos: Math.round(otros * 100) / 100, total: num(comp.getAttribute("Total")),
    moneda: comp.getAttribute("Moneda") ?? "MXN", tc: comp.getAttribute("TipoCambio") ? num(comp.getAttribute("TipoCambio")) : null,
    forma_pago: comp.getAttribute("FormaPago"), metodo_pago: comp.getAttribute("MetodoPago"),
  };
}

export const FORMA_PAGO: Record<string, string> = { "01": "Efectivo", "02": "Cheque", "03": "Transferencia", "04": "Tarjeta de crédito", "28": "Tarjeta de débito", "99": "Por definir" };
