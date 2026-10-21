import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadAkela } from "@/lib/data";
import { Akela } from "@/components/akela/Akela";

export const dynamic = "force-dynamic";

export default async function AkelaPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio } = await searchParams;
  const year = Number(anio) || new Date().getFullYear();
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/akela")) redirect(inicioDe(rol));
  const data = await loadAkela(supabase, year, rol);
  return <Akela initial={data} soloLectura={rol !== "dueno"} />;
}
