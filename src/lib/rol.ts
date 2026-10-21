import type { SupabaseClient } from "@supabase/supabase-js";

export type Rol = "dueno" | "contador" | "papas" | "hermano" | null;
/** Pestañas que puede ver cada rol (el dueño ve todo). */
export const PERMISOS: Record<Exclude<Rol, null>, string[] | "*"> = {
  dueno: "*",
  contador: ["/contabilidad", "/facturacion"],
  papas: ["/akela"],
  hermano: ["/akela"],
};
export async function rolActual(supabase: SupabaseClient): Promise<Rol> {
  const { data } = await supabase.rpc("mi_rol");
  return (data as Rol) ?? null;
}
export const puedeVer = (rol: Rol, path: string) => { const p = rol ? PERMISOS[rol] : null; return p === "*" || (Array.isArray(p) && p.some((x) => path.startsWith(x))); };
export const inicioDe = (rol: Rol) => { const p = rol ? PERMISOS[rol] : null; return p === "*" ? "/gastos" : Array.isArray(p) ? p[0] : "/login"; };
