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
  try {
    const { data, error } = await supabase.rpc("mi_rol");
    if (!error && data) return data as Rol;
    // respaldo: si la función no responde, el dueño es quien coincide con app_config.owner_id
    const [{ data: { user } }, cfg] = await Promise.all([supabase.auth.getUser(), supabase.from("app_config").select("owner_id").maybeSingle()]);
    if (error) console.error("mi_rol:", error.message);
    return user && cfg.data?.owner_id === user.id ? "dueno" : null;
  } catch (e) { console.error("rolActual:", (e as Error).message); return null; }
}
export const puedeVer = (rol: Rol, path: string) => { const p = rol ? PERMISOS[rol] : null; return p === "*" || (Array.isArray(p) && p.some((x) => path.startsWith(x))); };
export const inicioDe = (rol: Rol) => { const p = rol ? PERMISOS[rol] : null; return p === "*" ? "/gastos" : Array.isArray(p) ? p[0] : "/login"; };
