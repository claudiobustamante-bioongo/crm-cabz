import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { Megalodon, type MegActivo, type MegSeccion } from "@/components/megalodon/Megalodon";

export const dynamic = "force-dynamic";

export default async function MegalodonPage() {
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/megalodon")) redirect(inicioDe(rol));
  const { data: { user } } = await supabase.auth.getUser();
  const [s, a] = await Promise.all([
    supabase.from("megalodon_secciones").select("*").order("orden"),
    supabase.from("megalodon_activos").select("*").order("orden"),
  ]);
  const listo = !s.error && !a.error;
  return <Megalodon initial={{ secciones: (s.data ?? []) as MegSeccion[], activos: (a.data ?? []) as MegActivo[], userId: user?.id ?? "", listo }} />;
}
