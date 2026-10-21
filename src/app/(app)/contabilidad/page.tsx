import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadContabilidad } from "@/lib/data";
import { Contabilidad } from "@/components/contabilidad/Contabilidad";

export const dynamic = "force-dynamic";

export default async function ContabilidadPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/contabilidad")) redirect(inicioDe(rol));
  const data = await loadContabilidad(supabase, year);
  return <Contabilidad initial={data} soloLectura={rol !== "dueno"} />;
}
