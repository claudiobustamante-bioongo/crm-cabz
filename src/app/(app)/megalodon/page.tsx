import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { rolActual, puedeVer, inicioDe } from "@/lib/rol";
import { Megalodon, type MegActivo, type MegCuenta, type MegSeccion } from "@/components/megalodon/Megalodon";

export const dynamic = "force-dynamic";

export default async function MegalodonPage() {
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  if (!puedeVer(rol, "/megalodon")) redirect(inicioDe(rol));
  const { data: { user } } = await supabase.auth.getUser();
  const [s, a, c, led, act, tc] = await Promise.all([
    supabase.from("megalodon_secciones").select("*").order("orden"),
    supabase.from("megalodon_activos").select("*").order("orden"),
    supabase.from("cuentas").select("id,nombre,tipo,moneda").eq("activa", true).order("nombre"),
    supabase.from("v_saldo_cuentas").select("id,saldo,saldo_mxn"),
    supabase.from("v_saldo_actual").select("cuenta_id,fecha,saldo"),
    supabase.from("tipos_cambio").select("tc_mxn").eq("moneda", "USD").order("fecha", { ascending: false }).limit(1),
  ]);
  const listo = !s.error && !a.error;
  const tcHoy = Number(tc.data?.[0]?.tc_mxn ?? 18.5);
  const cuentas: MegCuenta[] = ((c.data ?? []) as { id: string; nombre: string; tipo: string; moneda: string }[]).map((x) => {
    if (x.tipo === "inversion" || x.tipo === "retiro" || x.tipo === "fondo") { const sa = (act.data ?? []).find((y) => y.cuenta_id === x.id); const v = Number(sa?.saldo ?? 0); return { ...x, saldo: v, saldo_mxn: x.moneda === "USD" ? v * tcHoy : v, fecha: sa?.fecha ?? null }; }
    const l = (led.data ?? []).find((y) => y.id === x.id); return { ...x, saldo: Number(l?.saldo ?? 0), saldo_mxn: Number(l?.saldo_mxn ?? 0), fecha: null };
  });
  const conSaldos = !!(a.data ?? []).length && "cuenta_id" in ((a.data ?? [])[0] ?? {});
  return <Megalodon initial={{ secciones: (s.data ?? []) as MegSeccion[], activos: (a.data ?? []) as MegActivo[], cuentas, userId: user?.id ?? "", listo, conSaldos }} />;
}
