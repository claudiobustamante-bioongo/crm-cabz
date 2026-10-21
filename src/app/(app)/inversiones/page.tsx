import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadInversiones } from "@/lib/data";
import { Inversiones } from "@/components/inversiones/Inversiones";

export const dynamic = "force-dynamic";

export default async function InversionesPage() {
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/inversiones")) redirect(inicioDe(rol));
  const data = await loadInversiones(supabase);
  return <Inversiones initial={data} />;
}
