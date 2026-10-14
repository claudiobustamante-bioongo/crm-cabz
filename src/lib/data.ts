import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asignacion, Catalogo, Cuenta, Evento, GastosData, Movimiento, Rubro } from "./types";

const TIPOS_GASTO = ["gasto", "ahorro", "abono_deuda"];

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

export async function loadGastos(supabase: SupabaseClient, anio: number): Promise<GastosData> {
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const [rubros, cuentas, libros, pagadores, eventos, movimientos, anios] = await Promise.all([
    supabase.from("rubros").select("id,codigo,nombre,padre_id,clasificacion,emoji,activo")
      .eq("naturaleza", "gasto").eq("activo", true).order("orden").order("nombre"),
    supabase.from("cuentas").select("id,nombre,tipo,es_medio_pago").eq("activa", true).order("nombre"),
    supabase.from("libros").select("codigo,nombre").eq("activo", true),
    supabase.from("pagadores").select("codigo,nombre").eq("activo", true),
    supabase.from("eventos").select("id,nombre").order("fecha_inicio", { ascending: false }),
    supabase.from("v_movimientos")
      .select("id,fecha,mes,tipo,estado,descripcion,monto,monto_mxn,moneda,cuenta,grupo,grupo_codigo,rubro,rubro_codigo,evento,notas")
      .in("tipo", TIPOS_GASTO).gte("fecha", desde).lte("fecha", hasta)
      .order("fecha", { ascending: false }).range(0, 9999),
    supabase.from("anios").select("anio").order("anio"),
  ]);

  const movs = must<Movimiento[]>(movimientos, "movimientos");
  const ids = movs.map((m) => m.id);
  const asignaciones = ids.length
    ? must<Asignacion[]>(
        await supabase.from("v_asignaciones").select("movimiento_id,libro,pagador,monto").in("movimiento_id", ids).range(0, 19999),
        "asignaciones",
      )
    : [];

  const listaAnios = must<{ anio: number }[]>(anios, "anios").map((a) => a.anio);
  if (!listaAnios.includes(anio)) listaAnios.push(anio);

  return {
    anio,
    anios: listaAnios.sort(),
    rubros: must<Rubro[]>(rubros, "rubros"),
    cuentas: must<Cuenta[]>(cuentas, "cuentas"),
    libros: must<Catalogo[]>(libros, "libros"),
    pagadores: must<Catalogo[]>(pagadores, "pagadores"),
    eventos: must<Evento[]>(eventos, "eventos"),
    movimientos: movs,
    asignaciones,
  };
}
