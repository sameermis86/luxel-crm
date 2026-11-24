"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, Bell, CalendarCheck2, CalendarRange, ChevronsUpDown, Flower2, LayoutDashboard, LogOut, Menu, Plus,
  Settings, Truck, Users, X, Handshake, type LucideIcon,
} from "lucide-react";

/** Luxel's divisions. The CRM is Sales & CRM; Fulfillment & Ops runs signed events; Floral orders is next. */
const DIVISIONS: { key: "sales" | "ops" | "floral"; label: string; href: string | null; icon: LucideIcon }[] = [
  { key: "sales", label: "Sales & CRM", href: "/", icon: Handshake },
  { key: "ops", label: "Fulfillment & Ops", href: "/ops", icon: Truck },
  { key: "floral", label: "Floral orders", href: null, icon: Flower2 },
];

export function divisionOf(path: string) {
  return path === "/ops" || path.startsWith("/ops/") ? "ops" : "sales";
}

interface Section { href: string; label: string; icon: LucideIcon; exact?: boolean; show?: boolean }

export interface ShellProps {
  user: { name: string; role: string };
  canImport: boolean;
  canSettings: boolean;
  notes: { id: string; title: string; leadId: string | null }[];
  children: React.ReactNode;
}

function sectionsFor(division: string, p: Pick<ShellProps, "canImport" | "canSettings">): Section[] {
  if (division === "ops") return [{ href: "/ops", label: "Event board", icon: CalendarRange, exact: true }];
  return [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: "/leads", label: "Leads", icon: Users },
    { href: "/follow-ups", label: "My follow-ups", icon: CalendarCheck2 },
    { href: "/imports", label: "Import", icon: ArrowDownToLine, show: p.canImport },
    { href: "/settings", label: "Settings", icon: Settings, show: p.canSettings },
  ].filter((s) => s.show !== false);
}

const isActive = (path: string, s: Section) => (s.exact ? path === s.href : path === s.href || path.startsWith(s.href + "/"));

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <rect width="32" height="32" rx="9" fill="#17201c" />
        {/* a cut stem with one leaf, the "L" of Luxel */}
        <path d="M12 7.5v17h9.5" fill="none" stroke="#f5f3ee" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.2 15.2c2.6-3.6 6.4-4.4 8.6-3.6-.6 3.3-4.4 5.8-8.6 3.6Z" fill="#8aa890" />
        <circle cx="22.6" cy="24.5" r="2.1" fill="#bc5468" />
      </svg>
      <span className="font-display leading-none tracking-[-0.02em]" style={{ fontSize: Math.round(size * 0.7) }}>Luxel</span>
    </span>
  );
}

function Initials({ name }: { name: string }) {
  const t = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stem-soft text-xs font-semibold text-stem-strong">{t}</span>;
}

/** Everything inside the sidebar (also used in the mobile drawer). */
function NavPanel(props: Omit<ShellProps, "children"> & { onNavigate?: () => void }) {
  const path = usePathname();
  const division = divisionOf(path);
  const current = DIVISIONS.find((d) => d.key === division)!;
  const [switcher, setSwitcher] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-4">
        <Link href="/" onClick={props.onNavigate} className="inline-flex rounded-md" aria-label="Luxel home">
          <Logo />
        </Link>
      </div>

      {/* division switcher */}
      <div className="relative px-3">
        <p className="eyebrow mb-1.5 px-2">Division</p>
        <button
          type="button"
          onClick={() => setSwitcher((o) => !o)}
          aria-expanded={switcher}
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-edge bg-card px-2.5 py-2 text-left text-sm font-medium shadow-xs transition-colors hover:border-ink/20"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-white"><current.icon size={15} strokeWidth={1.75} /></span>
          <span className="flex-1 truncate">{current.label}</span>
          <ChevronsUpDown size={15} className="text-muted" />
        </button>
        {switcher && (
          <ul className="absolute inset-x-3 top-full z-40 mt-1.5 rounded-[10px] border border-edge bg-card p-1 shadow-lg" role="menu">
            {DIVISIONS.map((d) => (
              <li key={d.key} role="none">
                {d.href ? (
                  <Link
                    role="menuitem"
                    href={d.href}
                    onClick={() => { setSwitcher(false); props.onNavigate?.(); }}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-paper ${d.key === division ? "font-medium" : "text-ink/80"}`}
                  >
                    <d.icon size={16} strokeWidth={1.75} className="text-muted" />
                    {d.label}
                    {d.key === division && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-bloom" aria-label="current" />}
                  </Link>
                ) : (
                  <span role="menuitem" aria-disabled className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-2 text-sm text-faint">
                    <d.icon size={16} strokeWidth={1.75} />
                    {d.label}
                    <span className="ml-auto rounded-full bg-paper-2 px-1.5 py-px text-[10px] font-medium tracking-wide text-muted uppercase">Next</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {division === "sales" && (
        <div className="px-3 pt-3">
          <Link href="/leads/new" onClick={props.onNavigate} className="btn-bloom w-full">
            <Plus size={16} strokeWidth={2} /> New lead
          </Link>
        </div>
      )}

      <nav aria-label="Section" className="mt-4 flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {sectionsFor(division, props).map((s) => {
            const active = isActive(path, s);
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  onClick={props.onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${active ? "bg-card font-medium text-ink shadow-xs ring-1 ring-edge" : "text-ink/75 hover:bg-ink/[0.04] hover:text-ink"}`}
                >
                  <s.icon size={17} strokeWidth={1.75} className={active ? "text-bloom" : "text-muted group-hover:text-ink"} />
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-edge p-3">
        <Notifications notes={props.notes} onNavigate={props.onNavigate} />
        <div className="mt-1 flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Initials name={props.user.name} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{props.user.name}</p>
            <p className="truncate text-xs text-muted capitalize">{props.user.role}</p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="btn-ghost h-8 w-8 px-0 text-muted" title="Sign out" aria-label="Sign out"><LogOut size={16} strokeWidth={1.75} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Notifications({ notes, onNavigate }: { notes: ShellProps["notes"]; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink/75 transition-colors hover:bg-ink/[0.04] hover:text-ink"
      >
        <Bell size={17} strokeWidth={1.75} className="text-muted" />
        Notifications
        {notes.length > 0 && <span className="ml-auto rounded-full bg-bloom px-1.5 text-[11px] font-medium text-white tabular">{notes.length}</span>}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-edge bg-card p-1.5 shadow-lg">
          <p className="eyebrow px-2 pt-1.5 pb-1">Notifications</p>
          {notes.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link href={n.leadId ? `/leads/${n.leadId}?seen=${n.id}` : "/"} onClick={() => { setOpen(false); onNavigate?.(); }} className="block rounded-md px-2 py-2 text-sm hover:bg-paper">
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** App frame: fixed sidebar on large screens, top bar + slide-over drawer below that. */
export function Shell(props: ShellProps) {
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [drawer]);
  const division = DIVISIONS.find((d) => d.key === divisionOf(path))!;
  const section = sectionsFor(division.key, props).find((s) => isActive(path, s));

  return (
    <div className="min-h-screen lg:pl-[248px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-white">Skip to content</a>

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-edge bg-paper-2/40 lg:block print:hidden">
        <NavPanel {...props} />
      </aside>

      {/* mobile / tablet top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-edge bg-paper/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-paper/75 lg:hidden print:hidden">
        <button type="button" className="btn-ghost -ml-2 h-9 w-9 px-0" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
          <Menu size={20} strokeWidth={1.75} />
        </button>
        <Link href="/" aria-label="Luxel home"><Logo size={26} /></Link>
        <span className="truncate text-sm text-muted">/ {section?.label ?? division.label}</span>
        <span className="flex-1" />
        {division.key === "sales" && (
          <Link href="/leads/new" className="btn-bloom btn-sm" aria-label="New lead"><Plus size={14} strokeWidth={2.2} /><span className="hidden sm:inline">New lead</span></Link>
        )}
      </header>

      {/* drawer */}
      <div className={`fixed inset-0 z-50 lg:hidden ${drawer ? "" : "pointer-events-none"}`} aria-hidden={!drawer}>
        <div className={`absolute inset-0 bg-ink/30 transition-opacity duration-200 ${drawer ? "opacity-100" : "opacity-0"}`} onClick={() => setDrawer(false)} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 w-[284px] max-w-[85vw] border-r border-edge bg-paper shadow-lg transition-transform duration-200 ease-[var(--ease-out-soft)] ${drawer ? "translate-x-0" : "-translate-x-full"}`}
        >
          <button type="button" className="btn-ghost absolute top-4 right-3 h-8 w-8 px-0" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
          {drawer && <NavPanel {...props} onNavigate={() => setDrawer(false)} />}
        </div>
      </div>

      <main id="main" className="mx-auto w-full max-w-[1320px] min-w-0 overflow-x-clip px-4 pt-6 pb-10 sm:px-6 lg:px-10 lg:pt-9">
        {props.children}
        <footer className="mt-16 flex flex-col gap-2 border-t border-edge pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between print:hidden">
          <span className="inline-flex items-center gap-2"><Logo size={18} /><span className="text-faint">·</span> Decor &amp; Flowers, Vaughan, Ontario</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/" className="hover:text-ink">Sales &amp; CRM</Link>
            <Link href="/ops" className="hover:text-ink">Fulfillment &amp; Ops</Link>
            <Link href="/follow-ups" className="hover:text-ink">My follow-ups</Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}
