"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavLink } from "./nav-link";

/** Luxel's divisions. The CRM is the Sales & CRM division; Fulfillment & Ops runs signed events. */
export const DIVISIONS = [
  { key: "sales", label: "Sales & CRM", href: "/" },
  { key: "ops", label: "Fulfillment & Ops", href: "/ops" },
  { key: "floral", label: "Floral orders", href: null }, // next phase
] as const;

export function divisionOf(path: string) {
  return path === "/ops" || path.startsWith("/ops/") ? "ops" : "sales";
}

export function DivisionSwitcher() {
  const current = divisionOf(usePathname());
  return (
    <nav aria-label="Divisions" className="flex items-center gap-0.5 rounded-md border border-edge bg-card p-0.5 text-sm">
      {DIVISIONS.map((d) =>
        d.href ? (
          <Link
            key={d.key}
            href={d.href}
            aria-current={current === d.key ? "page" : undefined}
            className={`rounded px-2.5 py-1 whitespace-nowrap transition-colors duration-150 ${current === d.key ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
          >
            {d.label}
          </Link>
        ) : (
          <span key={d.key} className="cursor-not-allowed rounded px-2.5 py-1 whitespace-nowrap text-muted/60" title="Coming next">
            {d.label} <span className="text-[10px] uppercase">soon</span>
          </span>
        ),
      )}
    </nav>
  );
}

export function SectionNav({ canImport, canSettings }: { canImport: boolean; canSettings: boolean }) {
  const current = divisionOf(usePathname());
  if (current === "ops") {
    return (
      <>
        <NavLink href="/ops" exact>Event board</NavLink>
      </>
    );
  }
  return (
    <>
      <NavLink href="/" exact>Dashboard</NavLink>
      <NavLink href="/leads">Leads</NavLink>
      <NavLink href="/follow-ups">My follow-ups</NavLink>
      {canImport && <NavLink href="/imports">Import</NavLink>}
      {canSettings && <NavLink href="/settings">Settings</NavLink>}
    </>
  );
}

export function NewLeadButton() {
  return divisionOf(usePathname()) === "sales" ? <Link href="/leads/new" className="btn-bloom hidden sm:inline-flex">+ New lead</Link> : null;
}
