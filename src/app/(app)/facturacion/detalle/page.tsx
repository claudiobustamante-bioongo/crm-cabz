import { createClient } from "@/lib/supabase/server";
import { loadFacturacion } from "@/lib/data";
import { Facturacion } from "@/components/facturacion/Facturacion";

export const dynamic = "force-dynamic";

export default async function DetallePage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const data = await loadFacturacion(supabase, year);
  return <Facturacion initial={data} vista="detalle" />;
}
