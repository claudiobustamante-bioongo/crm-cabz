import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadGastos } from "@/lib/data";
import { Gastos } from "@/components/gastos/Gastos";

export const dynamic = "force-dynamic";

export default async function GastosPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/gastos")) redirect(inicioDe(rol));
  const data = await loadGastos(supabase, year);
  return <Gastos initial={data} />;
}
