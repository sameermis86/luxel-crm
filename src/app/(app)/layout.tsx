import Link from "next/link";
import { requireSession, can } from "@/server/auth";
import { withCtx } from "@/db/client";
import { ctxFor } from "@/server/auth";
import { unreadNotifications } from "@/server/leads/queries";
import { NavLink } from "@/components/nav-link";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const notes = await withCtx(ctxFor(session), (tx) => unreadNotifications(tx, session.userId));
  return (
    <div className="min-h-screen">
      <header className="border-b border-edge bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80 sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="shrink-0">
            <span className="font-display text-xl">Luxel</span>
            <span className="ml-1.5 text-[10px] tracking-[0.2em] text-muted uppercase">Lead desk</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm" aria-label="Main">
            <NavLink href="/" exact>Dashboard</NavLink>
            <NavLink href="/leads">Leads</NavLink>
            <NavLink href="/follow-ups">My follow-ups</NavLink>
            {can(session, "imports:create") && <NavLink href="/imports">Import</NavLink>}
            {can(session, "campaigns:manage") && <NavLink href="/campaigns">Campaigns</NavLink>}
            {can(session, "settings:manage") && <NavLink href="/settings">Settings</NavLink>}
          </nav>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <Link href="/leads/new" className="btn-bloom hidden sm:inline-flex">+ New lead</Link>
            <details className="relative">
              <summary className="btn-ghost relative cursor-pointer list-none" aria-label={`${notes.length} notifications`}>
                <span aria-hidden>🔔</span>
                {notes.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 rounded-full bg-bloom px-1.5 text-[10px] text-white tabular">{notes.length}</span>
                )}
              </summary>
              <div className="card absolute right-0 z-40 mt-2 w-80 p-2 shadow-lg">
                {notes.length === 0 ? (
                  <p className="p-2 text-sm text-muted">No new notifications.</p>
                ) : (
                  <ul className="divide-y divide-edge">
                    {notes.map((n) => (
                      <li key={n.id}>
                        <Link href={n.leadId ? `/leads/${n.leadId}?seen=${n.id}` : "/"} className="block rounded p-2 text-sm hover:bg-paper">
                          {n.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
            <form action="/api/auth/logout" method="post">
              <button className="btn-ghost text-muted" title={`Signed in as ${session.name} (${session.role})`}>
                {session.name} · Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
