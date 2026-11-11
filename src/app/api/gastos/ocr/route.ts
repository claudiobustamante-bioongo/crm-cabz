import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Lee un ticket/factura con el modelo de visión de Anthropic y devuelve los campos del gasto. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en Vercel." }, { status: 500 });

  const form = await req.formData();
  const file = form.get("imagen") as File | null;
  if (!file) return NextResponse.json({ error: "Sin imagen." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Imagen muy grande (máx. 8 MB)." }, { status: 400 });
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mime = (file.type || "image/jpeg").replace("image/jpg", "image/jpeg");

  // catálogo para que el modelo sugiera rubro y subrubro con los nombres reales
  const { data: rubros } = await supabase.from("rubros").select("id,nombre,padre_id").eq("naturaleza", "gasto").eq("activo", true);
  const padres = (rubros ?? []).filter((r) => !r.padre_id);
  const catalogo = padres.map((p) => `${p.nombre}: ${(rubros ?? []).filter((r) => r.padre_id === p.id).map((r) => r.nombre).join(", ")}`).join("\n");
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });

  const prompt = `Lee este ticket, recibo o factura y devuelve SOLO un JSON (sin texto alrededor) con:
{"fecha":"YYYY-MM-DD","monto":número total pagado,"moneda":"MXN|USD|EUR","comercio":"nombre del establecimiento","descripcion":"qué se compró, 3-8 palabras","rubro":"uno de los rubros del catálogo","subrubro":"uno de los subrubros de ese rubro o null","propina_incluida":true|false,"confianza":0-1}
Reglas: si no se ve la fecha usa ${hoy}; el monto es el TOTAL final (con propina si la hay); si la moneda no es clara y el ticket es de México, MXN. Elige rubro y subrubro solo del catálogo; si ninguno encaja bien, pon el rubro más cercano y subrubro null.
Catálogo (rubro: subrubros):
${catalogo}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }, { type: "text", text: prompt }] }] }),
  });
  if (!r.ok) return NextResponse.json({ error: `Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}` }, { status: 502 });
  const j = await r.json();
  const texto: string = (j.content ?? []).map((c: { type: string; text?: string }) => c.text ?? "").join("");
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: "No pude leer el ticket. Intenta con una foto más clara." }, { status: 422 });
  let out: Record<string, unknown>;
  try { out = JSON.parse(m[0]); } catch { return NextResponse.json({ error: "Respuesta ilegible del lector." }, { status: 422 }); }
  const padre = padres.find((p) => p.nombre.toLowerCase() === String(out.rubro ?? "").toLowerCase());
  const sub = padre ? (rubros ?? []).find((x) => x.padre_id === padre.id && x.nombre.toLowerCase() === String(out.subrubro ?? "").toLowerCase()) : null;
  return NextResponse.json({ ...out, grupo_id: padre?.id ?? null, rubro_id: sub?.id ?? null });
}
