import { createClient } from "@/lib/supabase/server";
import { loadInversiones } from "@/lib/data";
import { Inversiones } from "@/components/inversiones/Inversiones";

export const dynamic = "force-dynamic";

export default async function InversionesPage() {
  const supabase = await createClient();
  const data = await loadInversiones(supabase);
  return <Inversiones initial={data} />;
}
