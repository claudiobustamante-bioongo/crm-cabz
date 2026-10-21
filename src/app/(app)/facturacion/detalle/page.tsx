import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadFacturacion } from "@/lib/data";
import { Facturacion } from "@/components/facturacion/Facturacion";

export const dynamic = "force-dynamic";

export default async function DetallePage({ searchParams }: { searchParams: Promise<{ anio?: string; mes?: string; tipo?: string; q?: string }> }) {
  const { anio, mes, tipo, q } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/facturacion")) redirect(inicioDe(rol));
  const data = await loadFacturacion(supabase, year);
  return <Facturacion initial={data} vista="detalle" filtro={{ mes, tipo, q }} soloLectura={rol !== "dueno"} />;
}
