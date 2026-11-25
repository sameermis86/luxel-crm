import Link from "next/link";
import { Upload } from "lucide-react";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { financeOverview } from "@/server/finance";
import { dateInTz } from "@/lib/dates";
import { titleCase } from "@/lib/format";
import { C } from "@/lib/chart-colors";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };

const cad = (n: number, whole = true) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: whole ? 0 : 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Finance overview: contracts imported from Goodshuffle, by event date. Accounting stays in Wave. */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const data = await withPage(async (tx, p) => {
    const today = dateInTz(p.now);
    const thisYear = Number(today.slice(0, 4));
    const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : thisYear;
    const o = await financeOverview(tx, `${year}-01-01`, `${year + 1}-01-01`, today);
    return { ...o, year, thisYear, today };
  }, "finance:view");
  const { kpis, byMonth, bySource, list, undated, lastImport, year, thisYear, today, page } = data;
  const canImport = can(page.session, "finance:manage");
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { key, label: MONTHS[i], ...(byMonth.find((m) => m.month === key) ?? { contracts: 0, total: 0, balance: 0 }) };
  });
  const max = Math.max(1, ...months.map((m) => m.total));
  const avg = kpis.contracts ? kpis.total / kpis.contracts : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Contracts & revenue"
        description="Signed contracts from Goodshuffle, by event date. Totals are as Goodshuffle reports them (including tax). Accounting lives in Wave."
        actions={
          <>
            <nav className="seg" aria-label="Year">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <Link key={y} href={`/finance?year=${y}`} aria-current={y === year ? "page" : undefined} className="seg-item">{y}</Link>
              ))}
            </nav>
            {canImport && <Link href="/finance/import" className="btn"><Upload size={15} strokeWidth={1.75} /> Import from Goodshuffle</Link>}
          </>
        }
      />

      {!lastImport ? (
        <div className="card px-5 py-10 text-center">
          <h2 className="text-[19px]">No contracts yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted">Export a projects or payments report from Goodshuffle as CSV (project number and total, plus paid and balance if it has them) and import it here. Re-import any time to update.</p>
          {canImport && <Link href="/finance/import" className="btn-primary mt-4">Import from Goodshuffle</Link>}
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={`${year} figures`}>
            <Kpi label={`Booked for ${year} events`} value={cad(kpis.total)} sub={`${kpis.contracts} contract${kpis.contracts === 1 ? "" : "s"}`} />
            <Kpi label="Collected" value={cad(kpis.paid)} sub={kpis.total ? `${Math.round((kpis.paid / kpis.total) * 100)}% of booked` : "—"} />
            <Kpi label="Still to collect" value={cad(kpis.balance)} sub={kpis.overdue > 0 ? `${cad(kpis.overdue)} for events already held` : "Nothing overdue"} tone={kpis.overdue > 0 ? "bloom" : undefined} />
            <Kpi label="Average booking" value={cad(avg)} sub={`${year} events`} />
          </section>

          <section className="card p-5">
            <h2 className="text-[19px]">Booked value by event month, {year}</h2>
            <div className="mt-4 flex h-48 items-end gap-[2px] border-b border-edge" role="img" aria-label={`Booked value by month in ${year}; the table below has the numbers`}>
              {months.map((m) => (
                <div key={m.key} className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0} aria-label={`${m.label} ${year}: ${cad(m.total)}, ${m.contracts} contracts`}>
                  {m.total > 0 && <div className="mx-auto w-[min(70%,36px)] rounded-t-[4px]" style={{ height: `${Math.max(2, (m.total / max) * 100)}%`, background: C.revenue }} />}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-edge bg-card px-2 py-1 text-xs whitespace-nowrap shadow-lg group-hover:block group-focus:block">
                    <strong className="font-medium">{m.label} {year}</strong> · {cad(m.total)} · {m.contracts} contract{m.contracts === 1 ? "" : "s"}{m.balance > 0 ? ` · ${cad(m.balance)} to collect` : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-[2px] text-center text-[11px] text-muted">{months.map((m) => <span key={m.key} className="flex-1">{m.label}</span>)}</div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted hover:text-ink">Table view</summary>
              <table className="mt-2 w-full max-w-lg">
                <thead><tr><th className="th pl-0">Month</th><th className="th text-right">Contracts</th><th className="th text-right">Booked</th><th className="th text-right">To collect</th></tr></thead>
                <tbody className="divide-y divide-edge">{months.map((m) => <tr key={m.key}><td className="td pl-0">{m.label}</td><td className="td text-right tabular">{m.contracts}</td><td className="td text-right tabular">{cad(m.total)}</td><td className="td text-right tabular">{cad(m.balance)}</td></tr>)}</tbody>
              </table>
            </details>
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="card overflow-hidden">
              <h2 className="px-5 pt-5 text-[19px]">Contracts, {year}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead className="bg-card-2"><tr><th className="th">Event</th><th className="th">Project</th><th className="th">Client</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th text-right">To collect</th></tr></thead>
                  <tbody className="divide-y divide-edge">
                    {list.length === 0 && <tr><td colSpan={6} className="td py-10 text-center text-muted">No contracts with {year} events.</td></tr>}
                    {list.map(({ c, recordId }) => {
                      const overdue = (c.balance ?? 0) > 0 && c.eventDate! < today;
                      return (
                        <tr key={c.id}>
                          <td className="td whitespace-nowrap tabular">{c.eventDate}</td>
                          <td className="td"><span className="font-mono text-xs text-muted">{c.project}</span>{c.leadId && <Link href={`/leads/${c.leadId}`} className="ml-2 text-xs text-muted hover:text-ink">{recordId}</Link>}</td>
                          <td className="td">{c.client ?? c.name ?? "—"}</td>
                          <td className="td text-right tabular">{cad(c.total ?? 0, false)}</td>
                          <td className="td text-right tabular">{c.paid == null ? "—" : cad(c.paid, false)}</td>
                          <td className={`td text-right tabular ${overdue ? "font-medium text-bloom-strong" : ""}`}>{c.balance == null ? "—" : cad(c.balance, false)}{overdue && <span className="block text-[11px] font-normal">event held</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <aside className="space-y-4">
              <section className="card p-5">
                <h2 className="text-[17px]">Booked by lead source</h2>
                <ul className="mt-2 divide-y divide-edge text-sm">
                  {bySource.map((s) => (
                    <li key={s.source} className="flex justify-between gap-2 py-1.5"><span>{s.source === "unlinked" ? <span className="text-muted">Not matched to a lead</span> : titleCase(s.source)}</span><span className="tabular">{cad(s.total)} <span className="text-xs text-muted">· {s.contracts}</span></span></li>
                  ))}
                  {bySource.length === 0 && <li className="py-2 text-muted">—</li>}
                </ul>
              </section>
              <section className="card p-5 text-sm">
                <h2 className="text-[17px]">Accounting: Wave</h2>
                <p className="mt-1 text-muted">Invoices, payments and the books stay in Wave. Linking won contracts to Wave comes later; for now the numbers here come from Goodshuffle.</p>
                <span className="chip mt-2 border-edge bg-card-2 text-muted">Not linked yet</span>
              </section>
              <p className="text-xs text-muted">
                Last import {lastImport.createdAt.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })}{lastImport.filename ? ` (${lastImport.filename})` : ""}: {lastImport.created} new, {lastImport.updated} updated.
                {undated > 0 ? ` ${undated} contract(s) have no event date and aren't in any year.` : ""}
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "bloom" }) {
  return (
    <div className="card p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[28px] leading-none tabular">{value}</p>
      <p className={`mt-1.5 text-xs ${tone === "bloom" ? "font-medium text-bloom-strong" : "text-muted"}`}>{sub}</p>
    </div>
  );
}
