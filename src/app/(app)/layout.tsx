import { logout } from "@/app/login/actions";
import { Tabs } from "@/components/Tabs";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap">
      <div className="topline">
        <div className="brandbar" style={{ margin: 0 }}>CABZ<b>·</b>CRM personal</div>
        <form action={logout}><button className="link" type="submit">Salir</button></form>
      </div>
      <div className="tag" style={{ marginTop: 14 }}>Un solo sitio · gastos, ingresos, inversiones, facturas y Akela</div>
      <Tabs />
      {children}
      <div className="footer"><b>CRM CABZ · Edición Fable</b>Los datos viven en tu Supabase; nada se guarda en este navegador.</div>
    </div>
  );
}
