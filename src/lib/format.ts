export const fmt = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });
export const fmt2 = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MESN = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** 'YYYY-MM' o 'YYYY-MM-DD' → 'oct 26' */
export const ml = (k: string) => MESN[+k.slice(5, 7) - 1] + " " + k.slice(2, 4);
export const mesKey = (fecha: string) => fecha.slice(0, 7);
export const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" }); // YYYY-MM-DD

export const niceStep = (max: number) => {
  const raw = max / 5 || 1, p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= raw) ?? raw;
};

const PALETTE = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8", "--c9", "--c10", "--c11", "--c12", "--c13", "--c14", "--c15", "--c16", "--c17", "--c18"];
const FIXED: Record<string, string> = {
  Akela: "--akela", Supermercado: "--c1", Viajes: "--c3", Salud: "--c6", "Restaurantes / Delivery": "--c4",
  Renta: "--c10", Deuda: "--c8", Ahorro: "--c7", Bioongo: "--c15", Entretenimiento: "--c5",
};
const assigned: Record<string, string> = { ...FIXED };
let next = 10;
/** Color estable por rubro (los del Excel fijos, los nuevos rotan la paleta). */
export const color = (c: string) => {
  if (!assigned[c]) assigned[c] = PALETTE[next++ % PALETTE.length];
  return `var(${assigned[c]})`;
};

export const cuentaColor = (c: string) =>
  c === "AMEX" ? "var(--aho)" : c === "Cheques" ? "var(--nec)" : c.startsWith("TDC") ? "var(--gus)" : "var(--gray-soft)";

export const slug = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 40);

export const CLS_LABEL: Record<string, string> = { N: "Necesidad", G: "Gusto", A: "Ahorro", D: "Deuda" };
export const CLS_COLOR: Record<string, string> = { N: "var(--nec)", G: "var(--gus)", A: "var(--aho)", D: "var(--deu)" };
