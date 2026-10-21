import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadIngresos } from "@/lib/data";
import { Ingresos } from "@/components/ingresos/Ingresos";

export const dynamic = "force-dynamic";

export default async function IngresosPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/ingresos")) redirect(inicioDe(rol));
  const data = await loadIngresos(supabase, year);
  return <Ingresos initial={data} />;
}
