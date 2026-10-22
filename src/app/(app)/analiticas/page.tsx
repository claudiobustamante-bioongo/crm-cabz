import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { loadAnaliticas } from "@/lib/data";
import { Analiticas } from "@/components/analiticas/Analiticas";

export const dynamic = "force-dynamic";

export default async function AnaliticasPage() {
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/analiticas")) redirect(inicioDe(rol));
  const data = await loadAnaliticas(supabase);
  return <Analiticas initial={data} />;
}
