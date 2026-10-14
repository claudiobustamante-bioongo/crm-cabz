import { createClient } from "@/lib/supabase/server";
import { loadIngresos } from "@/lib/data";
import { Ingresos } from "@/components/ingresos/Ingresos";

export const dynamic = "force-dynamic";

export default async function IngresosPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const data = await loadIngresos(supabase, year);
  return <Ingresos initial={data} />;
}
