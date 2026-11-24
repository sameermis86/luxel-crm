import Link from "next/link";
import { withPage } from "@/server/page";
import { computeDashboard } from "@/server/dashboard";
import { listUsers } from "@/server/leads/queries";
import { parseDashFilter, RANGE_LABELS } from "@/lib/metrics";
import { fmtDate, titleCase } from "@/lib/format";
import { SOURCES, EVENT_TYPES } from "@/db/schema";
import { SourceChart, WeeklyChart } from "@/components/dashboard-charts";
import { C } from "@/lib/chart-colors";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const data = await withPage(async (tx, p) => {
    const df = parseDashFilter(sp, p.now, p.settings.businessHours.timezone);
    const [d, users] = await Promise.all([computeDashboard(tx, df, p.wc), listUsers(tx)]);
    return { df, d, users };
  });
  const { df, d, users } = data;
  const one = (v?: string[]) => (v?.length === 1 ? v[0] : "");
  const funnelMax = Math.max(1, d.funnel[0]?.value ?? 1);
  const days = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)} d`);
  const conversion = d.cards.find((c) => c.key === "conversion")!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Lead desk</h1>
        <p className="mt-1 text-sm text-muted">
          {fmtDate(df.from)} – {fmtDate(df.to)} · every number opens the leads behind it
        </p>
      </div>

      {/* Filters: one row above everything */}
      <form method="get" className="card flex flex-wrap items-end gap-3 p-3">
        <label className="block">
          <span className="label">Date range</span>
          <select name="range" defaultValue={df.range} className="input">
            {Object.entries(RANGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </label>
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={df.from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={df.to} className="input" /></label>
        <Sel name="owner" label="Owner" value={one(df.owner)} options={[["me", "Me"], ["unassigned", "Unassigned"], ...users.map((u) => [u.id, u.name] as [string, string])]} />
        <Sel name="source" label="Source" value={one(df.source)} options={SOURCES.map((s) => [s, titleCase(s)])} />
        <Sel name="event_type" label="Event type" value={one(df.event_type)} options={EVENT_TYPES.map((s) => [s, titleCase(s)])} />
        <button className="btn-primary">Apply</button>
        <Link href="/" className="btn-ghost">Reset</Link>
        <p className="w-full text-xs text-muted">Choose “Custom…” to use the From/To dates; the other ranges ignore them.</p>
      </form>

      {/* Metric cards */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" aria-label="Key metrics">
        {d.cards.map((c) => (
          <Link key={c.key} href={c.href} className="card group block p-4 transition-colors hover:border-ink/40" title={c.definition} data-metric={c.key} data-value={c.numerator ? c.numerator.value : c.value}>
            <div className="text-xs tracking-wide text-muted uppercase">{c.label}</div>
            <div className={`mt-1 font-display text-3xl tabular ${c.key === "awaiting" && c.value > 0 ? "text-bloom" : ""}`}>{c.display}</div>
            {c.numerator ? (
              <div className="mt-1 text-xs text-muted">{c.numerator.value} won of {c.denominator!.value} created</div>
            ) : (
              <div className="mt-1 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100">View leads →</div>
            )}
          </Link>
        ))}
      </section>
      <div className="-mt-3 flex flex-wrap gap-4 text-xs text-muted">
        {d.detail.map((r) => (
          <span key={r.key} title={r.definition}>
            {r.label}: <span className="font-medium text-ink">{r.display}</span>{" "}
            (<Link className="underline" href={r.numerator!.href}>{r.numerator!.value}</Link> / <Link className="underline" href={r.denominator!.href}>{r.denominator!.value}</Link>)
          </span>
        ))}
        <span>Conversion denominator: <Link className="underline" href={conversion.denominator!.href}>{conversion.denominator!.value} leads created in range</Link></span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="text-xl">Leads by source</h2>
          <p className="mb-2 text-xs text-muted">Leads created in range, and how many of them are won. Click a bar for the list.</p>
          <SourceChart data={d.bySource.map((s) => ({ ...s, label: titleCase(s.source) }))} />
          <TableView
            head={["Source", "Leads", "Won"]}
            rows={d.bySource.map((s) => [titleCase(s.source), <Link key="l" className="underline" href={s.href}>{s.leads}</Link>, <Link key="w" className="underline" href={s.wonHref}>{s.won}</Link>])}
          />
        </section>

        <section className="card p-4">
          <h2 className="text-xl">Funnel</h2>
          <p className="mb-3 text-xs text-muted">Leads created in range that reached each stage.</p>
          <ol className="space-y-2">
            {d.funnel.map((f, i) => {
              const prev = i ? d.funnel[i - 1].value : null;
              return (
                <li key={f.key}>
                  <Link href={f.href} className="group block" aria-label={`${f.label}: ${f.value} leads`}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium group-hover:underline">{f.label}</span>
                      <span className="tabular">
                        {f.value}
                        {prev ? <span className="ml-2 text-xs text-muted">{((f.value / prev) * 100).toFixed(0)}% of previous</span> : null}
                      </span>
                    </div>
                    <div className="mt-1 h-6 rounded bg-paper">
                      <div className="h-6 rounded-r-[4px] group-hover:opacity-90" style={{ width: `${Math.max(1.5, (f.value / funnelMax) * 100)}%`, background: f.key === "won" ? C.won : C.leads }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-edge pt-3 text-xs sm:grid-cols-5">
            <Stat k="New → contacted" v={days(d.stages.toContact)} />
            <Stat k="Contacted → consult" v={days(d.stages.toConsult)} />
            <Stat k="Consult → proposal" v={days(d.stages.toProposal)} />
            <Stat k="Proposal → won" v={days(d.stages.toWon)} />
            <Stat k="Created → won" v={days(d.stages.createdToWon)} />
          </dl>
          <p className="mt-1 text-[11px] text-muted">Median days per stage, for leads created in range.</p>
        </section>
      </div>

      <section className="card p-4">
        <h2 className="text-xl">Leads per week</h2>
        <p className="mb-2 text-xs text-muted">By qualification (weeks start Monday, Toronto time). Click a segment for those leads.</p>
        <WeeklyChart data={d.weekly} />
        <TableView
          head={["Week of", "Qualified", "Needs info", "Unqualified", "Total"]}
          rows={d.weekly.map((w) => [
            w.label,
            <Link key="q" className="underline" href={w.hrefs.qualified}>{w.qualified}</Link>,
            <Link key="n" className="underline" href={w.hrefs.needs_info}>{w.needs_info}</Link>,
            <Link key="u" className="underline" href={w.hrefs.unqualified}>{w.unqualified}</Link>,
            <Link key="t" className="underline" href={w.href}>{w.total}</Link>,
          ])}
        />
      </section>

      <section className="card p-4">
        <h2 className="text-xl">Quotes</h2>
        <p className="text-xs text-muted">Quotes go out from the proposals tool; mark a lead “Proposal sent” here to track it. Revenue is tracked in the proposals tool.</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Big k="Quotes sent in range" v={String(d.quotes.sent.value)} href={d.quotes.sent.href} />
          <Big k="Awaiting client decision" v={String(d.quotes.awaitingDecision.value)} href={d.quotes.awaitingDecision.href} />
          <Big k="Quote → won (median)" v={days(d.stages.toWon)} />
        </dl>
      </section>
    </div>
  );
}

function Sel({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select name={name} defaultValue={value} className="input">
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium tabular">{v}</dd>
    </div>
  );
}

function Big({ k, v, href }: { k: string; v: string; href?: string }) {
  const inner = (
    <>
      <dt className="text-xs tracking-wide text-muted uppercase">{k}</dt>
      <dd className="font-display text-2xl tabular">{v}</dd>
    </>
  );
  return href ? <Link href={href} className="block rounded-md p-1 hover:bg-paper/60">{inner}</Link> : <div className="p-1">{inner}</div>;
}

function TableView({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs text-muted">View as table</summary>
      <table className="mt-2 w-full">
        <thead><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-edge">
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="td tabular">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </details>
  );
}
