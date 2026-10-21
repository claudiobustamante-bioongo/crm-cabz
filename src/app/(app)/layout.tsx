import { logout } from "@/app/login/actions";
import { Tabs } from "@/components/Tabs";
import { createClient } from "@/lib/supabase/server";
import { rolActual, PERMISOS } from "@/lib/rol";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const rol = await rolActual(supabase);
  const permitidas = rol && PERMISOS[rol] !== "*" ? (PERMISOS[rol] as string[]) : undefined;
  return (
    <div className="wrap">
      <div className="topline">
        <div className="brandbar" style={{ margin: 0 }}>CABZ<b>·</b>CRM personal</div>
        <form action={logout}><button className="link" type="submit">Salir</button></form>
      </div>
      <div className="tag" style={{ marginTop: 14 }}>{rol === "contador" ? "Vista del contador · Contabilidad y Facturación, solo lectura" : "Un solo sitio · gastos, ingresos, inversiones, facturas y Akela"}</div>
      <Tabs permitidas={permitidas} rol={rol} />
      {children}
      <div className="footer"><b>CRM CABZ · Edición Fable</b>Los datos viven en tu Supabase; nada se guarda en este navegador.</div>
    </div>
  );
}
