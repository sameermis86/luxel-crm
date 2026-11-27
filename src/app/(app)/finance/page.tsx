import Link from "next/link";
import { Upload } from "lucide-react";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { financeOverview, financeYears, waveBalances } from "@/server/finance";
import { getWaveState, waveConfigured } from "@/server/integrations/wave";
import { waveAccounts } from "@/db/schema";
import { sql } from "drizzle-orm";
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
    const years = await financeYears(tx);
    // default: this year if it has contracts, else the next year that does, else the latest
    const fallback = years.includes(thisYear) ? thisYear : years.find((y) => y > thisYear) ?? years[years.length - 1] ?? thisYear;
    const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : fallback;
    const o = await financeOverview(tx, `${year}-01-01`, `${year + 1}-01-01`, today);
    const [cash] = await tx
      .select({ total: sql<number>`coalesce(sum(${waveAccounts.balance}), 0)::float`, n: sql<number>`count(*)::int` })
      .from(waveAccounts)
      .where(sql`${waveAccounts.subtype} = 'CASH_AND_BANK' and not ${waveAccounts.archived}`);
    const balances = waveConfigured() ? await waveBalances(tx, today) : null;
    return { ...o, year, years, today, cash, balances, waveState: waveConfigured() ? await getWaveState(p.session.orgId) : null };
  }, "finance:view");
  const { kpis, ahead, byMonth, bySource, list, undated, lastImport, year, years, page, wave, waveState, cash, balances } = data;
  // invoice figures only when Wave is actually used for invoicing (Luxel's Wave holds bank transactions)
  const waveOn = !!waveState?.lastRunAt && !waveState.lastError && (wave.year.count > 0 || wave.invoicedBy.size > 0);
  const canImport = can(page.session, "finance:manage");
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { key, label: MONTHS[i], ...(byMonth.find((m) => m.month === key) ?? { contracts: 0, total: 0 }) };
  });
  const max = Math.max(1, ...months.map((m) => m.total));
  const avg = kpis.contracts ? kpis.total / kpis.contracts : 0;
  const best = months.reduce<(typeof months)[number] | null>((b, m) => (m.total > (b?.total ?? 0) ? m : b), null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Contracts & revenue"
        description="Revenue from signed Goodshuffle contracts, by event date. Amounts are contract totals as Goodshuffle reports them (including tax). Accounting lives in Wave."
        actions={
          <>
            <nav className="seg" aria-label="Year">
              {(years.length ? years : [year]).map((y) => (
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
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted">Export the project list from Goodshuffle as CSV and import it here: only signed contracts are kept. Re-import any time to update.</p>
          {canImport && <Link href="/finance/import" className="btn-primary mt-4">Import from Goodshuffle</Link>}
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={`${year} figures`}>
            <Kpi label={`Revenue, ${year} events`} value={cad(kpis.total)} sub={`${kpis.contracts} signed contract${kpis.contracts === 1 ? "" : "s"}`} />
            <Kpi label="Average booking" value={cad(avg)} sub={`${year} events`} />
            {waveOn ? (
              <Kpi label={`Invoiced in Wave, ${year}`} value={cad(wave.year.total)} sub={`${wave.year.count} invoice${wave.year.count === 1 ? "" : "s"} dated ${year}`} />
            ) : (
              <Kpi label="Biggest month" value={best ? cad(best.total) : "—"} sub={best ? `${best.label} ${year}, ${best.contracts} contract${best.contracts === 1 ? "" : "s"}` : "—"} />
            )}
            <Kpi label="All upcoming events" value={cad(ahead.total)} sub={`${ahead.contracts} contract${ahead.contracts === 1 ? "" : "s"} from today on, every year`} />
          </section>

          <section className="card p-5">
            <h2 className="text-[19px]">Revenue by event month, {year}</h2>
            <div className="mt-4 flex h-48 items-end gap-[2px] border-b border-edge" role="img" aria-label={`Revenue by month in ${year}; the table view has the numbers`}>
              {months.map((m) => (
                <div key={m.key} className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0} aria-label={`${m.label} ${year}: ${cad(m.total)}, ${m.contracts} contracts`}>
                  {m.total > 0 && <div className="mx-auto w-[min(70%,36px)] rounded-t-[4px]" style={{ height: `${Math.max(2, (m.total / max) * 100)}%`, background: C.revenue }} />}
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-edge bg-card px-2 py-1 text-xs whitespace-nowrap shadow-lg group-hover:block group-focus:block">
                    <strong className="font-medium">{m.label} {year}</strong> · {cad(m.total)} · {m.contracts} contract{m.contracts === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-[2px] text-center text-[11px] text-muted">{months.map((m) => <span key={m.key} className="flex-1">{m.label}</span>)}</div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted hover:text-ink">Table view</summary>
              <table className="mt-2 w-full max-w-lg">
                <thead><tr><th className="th pl-0">Month</th><th className="th text-right">Contracts</th><th className="th text-right">Revenue</th></tr></thead>
                <tbody className="divide-y divide-edge">{months.map((m) => <tr key={m.key}><td className="td pl-0">{m.label}</td><td className="td text-right tabular">{m.contracts}</td><td className="td text-right tabular">{cad(m.total)}</td></tr>)}</tbody>
              </table>
            </details>
          </section>

          {balances && balances.groups.length > 0 && <Balances b={balances} />}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="card overflow-hidden">
              <h2 className="px-5 pt-5 text-[19px]">Contracts, {year}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead className="bg-card-2"><tr><th className="th">Event</th><th className="th">Project</th><th className="th">Client</th><th className="th text-right">Revenue</th>{waveOn && <th className="th text-right">Invoiced in Wave</th>}</tr></thead>
                  <tbody className="divide-y divide-edge">
                    {list.length === 0 && <tr><td colSpan={waveOn ? 5 : 4} className="td py-10 text-center text-muted">No contracts with {year} events.</td></tr>}
                    {list.map(({ c, recordId }) => {
                      return (
                        <tr key={c.id}>
                          <td className="td whitespace-nowrap tabular">{c.eventDate}</td>
                          <td className="td"><span className="font-mono text-xs text-muted">{c.project}</span>{c.leadId && <Link href={`/leads/${c.leadId}`} className="ml-2 text-xs text-muted hover:text-ink">{recordId}</Link>}</td>
                          <td className="td">{c.client ?? c.name ?? "—"}</td>
                          <td className="td text-right tabular">{cad(c.total ?? 0, false)}</td>
                          {waveOn && (() => {
                            const w = wave.invoicedBy.get(c.id);
                            return (
                              <td className="td text-right tabular">
                                {w ? <>{cad(w.total, false)}{w.count > 1 && <span className="block text-[11px] text-muted">{w.count} invoices</span>}</> : <span className="chip border-amber/30 bg-amber-soft text-amber">Not invoiced</span>}
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <aside className="space-y-4">
              <section className="card p-5">
                <h2 className="text-[17px]">Revenue by lead source</h2>
                <ul className="mt-2 divide-y divide-edge text-sm">
                  {bySource.map((s) => (
                    <li key={s.source} className="flex justify-between gap-2 py-1.5"><span>{s.source === "unlinked" ? <span className="text-muted">Not matched to a lead</span> : titleCase(s.source)}</span><span className="tabular">{cad(s.total)} <span className="text-xs text-muted">· {s.contracts}</span></span></li>
                  ))}
                  {bySource.length === 0 && <li className="py-2 text-muted">—</li>}
                </ul>
              </section>
              <section className="card p-5 text-sm">
                <h2 className="text-[17px]">Accounting: Wave</h2>
                {!waveState ? (
                  <>
                    <p className="mt-1 text-muted">Not connected. Add <code className="font-mono text-xs">WAVE_ACCESS_TOKEN</code> in Vercel (a Full Access Token from Wave&apos;s developer portal) to bring in invoices, read-only.</p>
                    <span className="chip mt-2 border-edge bg-card-2 text-muted">Not linked yet</span>
                  </>
                ) : waveState.lastError ? (
                  <p className="mt-1 text-bloom">Last sync failed: {waveState.lastError}</p>
                ) : !waveState.lastRunAt ? (
                  <p className="mt-1 text-muted">Connected; the first sync runs within 15 minutes.</p>
                ) : (
                  <>
                    <p className="mt-1 text-muted">
                      {waveState.businessName}: {waveState.accounts ?? 0} accounts synced, read-only.
                      {cash.n > 0 && <> Cash &amp; bank today: <span className="font-medium text-ink tabular">{cad(cash.total)}</span>.</>}
                      {(waveState.invoices ?? 0) > 0 && ` ${waveState.invoices} invoices, ${waveState.matched} matched to a contract.`}
                    </p>
                    <p className="hint">Synced {new Date(waveState.lastRunAt).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })}</p>
                  </>
                )}
              </section>
              {waveOn && wave.unmatched.length > 0 && (
                <section className="card p-5 text-sm">
                  <h2 className="text-[17px]">Wave invoices without a contract, {year}</h2>
                  <p className="mt-1 text-xs text-muted">No Goodshuffle project number we know on these. Add it to the invoice&apos;s PO/SO number in Wave to match it.</p>
                  <ul className="mt-2 divide-y divide-edge">
                    {wave.unmatched.map((u) => (
                      <li key={u.id} className="flex justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate">{u.viewUrl ? <a href={u.viewUrl} target="_blank" rel="noreferrer" className="hover:underline">#{u.invoiceNumber}</a> : `#${u.invoiceNumber}`} <span className="text-muted">{u.customerName ?? ""}{u.project ? ` · ${u.project}` : ""}</span></span>
                        <span className="tabular">{cad(u.total ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
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

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[28px] leading-none tabular">{value}</p>
      <p className="mt-1.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

const SUBTYPE_LABELS: Record<string, string> = {
  CASH_AND_BANK: "Cash & bank", MONEY_IN_TRANSIT: "Money in transit", RECEIVABLE_INVOICES: "Owed by clients (invoices)", RECEIVABLE_OTHER: "Other receivables",
  OTHER_CURRENT_ASSETS: "Other current assets", PROPERTY_PLANT_EQUIPMENT: "Equipment & property", CREDIT_CARD: "Credit cards", SALES_TAX: "Sales tax owing",
  LOANS: "Loans", DUE_FOR_PAYROLL: "Payroll owing", CUSTOMER_PREPAYMENTS_AND_CREDITS: "Client deposits & credits", OTHER_CURRENT_LIABILITY: "Other current liabilities",
  OTHER_LONG_TERM_LIABILITY: "Long-term liabilities", DUE_TO_YOU_AND_OTHER_OWNERS: "Owed to owners", RETAINED_EARNINGS: "Retained earnings", NON_RETAINED_EARNINGS: "Owner investment & drawings",
};
const TYPE_LABELS: Record<string, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity" };
const label = (s: string | null) => (s ? SUBTYPE_LABELS[s] ?? titleCase(s.toLowerCase()) : "Other");

/** Balances from Wave (live) with the change since the snapshots ~7 and ~30 days ago, and the cash & bank trend. */
function Balances({ b }: { b: NonNullable<Awaited<ReturnType<typeof import("@/server/finance").waveBalances>>> }) {
  const delta = (now: number, then: number | null) => {
    if (then == null) return <span className="text-faint">—</span>;
    const d = Math.round(now - then);
    return <span className={d === 0 ? "text-muted" : "text-ink"}>{d > 0 ? "+" : d < 0 ? "−" : ""}{cad(Math.abs(d))}</span>;
  };
  const max = Math.max(1, ...b.cashTrend.map((d) => Math.abs(d.total)));
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[19px]">Balances from Wave</h2>
        <p className="text-xs text-muted">
          Live from Wave every 15 minutes; a snapshot is kept each day{b.firstSnapshot ? `, since ${b.firstSnapshot}` : ""}. Changes appear once there&apos;s a week or a month of history.
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr><th className="th pl-0">Account group</th><th className="th text-right">Today</th><th className="th text-right">7 days</th><th className="th text-right">30 days</th></tr></thead>
          <tbody>
            {(["ASSET", "LIABILITY", "EQUITY"] as const).map((t) => {
              const rows = b.groups.filter((g) => g.type === t);
              if (!rows.length) return null;
              return [
                <tr key={t}><td colSpan={4} className="pt-3 pb-1 text-[13px] font-medium text-muted">{TYPE_LABELS[t]}</td></tr>,
                ...rows.map((g) => (
                  <tr key={`${t}:${g.subtype}`} className="border-t border-edge">
                    <td className="td pl-0">{label(g.subtype)}</td>
                    <td className="td text-right tabular font-medium">{cad(g.total)}</td>
                    <td className="td text-right tabular">{delta(g.total, g.week)}</td>
                    <td className="td text-right tabular">{delta(g.total, g.month)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <h3 className="mt-5 text-[15px] font-medium">Cash &amp; bank, daily</h3>
      {b.cashTrend.length < 2 ? (
        <p className="mt-1 text-sm text-muted">History starts {b.firstSnapshot ?? "today"}; the trend fills in day by day.</p>
      ) : (
        <>
          <div className="mt-3 flex h-32 items-end gap-[2px] border-b border-edge" role="img" aria-label="Cash and bank balance by day; the table view has the numbers">
            {b.cashTrend.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0} aria-label={`${d.day}: ${cad(d.total)}`}>
                <div className="mx-auto w-full max-w-[18px] rounded-t-[4px]" style={{ height: `${Math.max(2, (Math.abs(d.total) / max) * 100)}%`, background: C.leads }} />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-edge bg-card px-2 py-1 text-xs whitespace-nowrap shadow-lg group-hover:block group-focus:block">{d.day} · {cad(d.total)}</span>
              </div>
            ))}
          </div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-muted hover:text-ink">Table view</summary>
            <ul className="mt-1 max-h-48 overflow-auto text-xs">{b.cashTrend.map((d) => <li key={d.day} className="flex justify-between py-0.5"><span>{d.day}</span><span className="tabular">{cad(d.total)}</span></li>)}</ul>
          </details>
        </>
      )}
    </section>
  );
}
