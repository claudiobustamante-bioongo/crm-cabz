import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadFacturacion } from "@/lib/data";
import { Facturacion } from "@/components/facturacion/Facturacion";

export const dynamic = "force-dynamic";

export default async function FacturacionPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/facturacion")) redirect(inicioDe(rol));
  const data = await loadFacturacion(supabase, year);
  return <Facturacion initial={data} soloLectura={rol !== "dueno"} />;
}
