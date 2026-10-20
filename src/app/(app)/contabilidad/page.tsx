import { createClient } from "@/lib/supabase/server";
import { loadContabilidad } from "@/lib/data";
import { Contabilidad } from "@/components/contabilidad/Contabilidad";

export const dynamic = "force-dynamic";

export default async function ContabilidadPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const data = await loadContabilidad(supabase, year);
  return <Contabilidad initial={data} />;
}
