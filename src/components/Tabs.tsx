"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const TABS = [
  { href: "/ingresos", label: "Ingresos", title: "Lo que entra, y qué queda", ready: true },
  { href: "/gastos", label: "Gastos", title: "Registra, y abajo se acomoda solo", ready: true },
  { href: "/inversiones", label: "Inversiones e impuestos", title: "Inversiones e impuestos, al centavo", ready: true },
  { href: "/facturacion", label: "Facturación", title: "Facturación · CFDI", ready: true },
  { href: "/akela", label: "Akela", title: "Familia Akela · proyección y control", ready: false },
  { href: "/analiticas", label: "Analíticas", title: "Analíticas · a dónde se va tu vida", ready: false },
];

export function Tabs() {
  const path = usePathname();
  const cur = TABS.find((t) => path.startsWith(t.href));
  return (
    <>
      <h1>{cur?.title ?? "CRM CABZ"}</h1>
      <nav className="tabs" aria-label="Secciones">
        {TABS.map((t) =>
          t.ready ? (
            <Link key={t.href} href={t.href} aria-current={path.startsWith(t.href) ? "page" : undefined}>{t.label}</Link>
          ) : (
            <a key={t.href} aria-disabled="true" title="Próxima sesión">{t.label}</a>
          ),
        )}
      </nav>
    </>
  );
}
