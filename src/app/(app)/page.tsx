import Link from "next/link";
import { withPage } from "@/server/page";
import { computeDashboard } from "@/server/dashboard";
import { listUsers } from "@/server/leads/queries";
import { parseDashFilter, RANGE_LABELS } from "@/lib/metrics";
import { fmtDate, titleCase } from "@/lib/format";
import { SOURCES, EVENT_TYPES } from "@/db/schema";
import { SourceChart, TrendChart } from "@/components/dashboard-charts";
import { C } from "@/lib/chart-colors";
import type { CardValue } from "@/server/dashboard";

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
  const leadsCount = d.cards.find((c) => c.key === "leads")!.value;
  const rangeLabel = df.range && df.range !== "custom" ? RANGE_LABELS[df.range as keyof typeof RANGE_LABELS].toLowerCase() : `${fmtDate(df.from)} – ${fmtDate(df.to)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Lead desk</h1>
        <p className="mt-1 text-sm text-muted">
          {fmtDate(df.from)} – {fmtDate(df.to)} · every number opens the leads behind it; hover a number for how it is counted
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

      {/* Metric cards: the range group, then today */}
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="range-h">
          <h2 id="range-h" className="mb-2 text-xs tracking-wide text-muted uppercase">Leads that came in · {rangeLabel}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.cards.map((c) => (
              <Card key={c.key} c={c} sub={c.numerator ? `${c.numerator.value} ${c.nouns![0]} of ${c.denominator!.value} ${c.nouns![1]}` : c.key !== "leads" && leadsCount ? `${Math.round((c.value / leadsCount) * 100)}% of leads` : "View leads →"} />
            ))}
          </div>
        </section>
        <section aria-labelledby="now-h">
          <h2 id="now-h" className="mb-2 text-xs tracking-wide text-muted uppercase">Right now</h2>
          <div className="grid grid-cols-2 gap-3">
            {d.now.map((c) => (
              <Card key={c.key} c={c} sub="View leads →" alert={c.key === "awaiting" && c.value > 0} />
            ))}
          </div>
        </section>
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
          <p className="mb-3 text-xs text-muted">Leads that came in during the range, by the furthest stage they have reached.</p>
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
        </section>
      </div>

      <section className="card p-4">
        <h2 className="text-xl">Leads per {d.bucket}</h2>
        <p className="mb-2 text-xs text-muted">When leads came in, colored by where they stand now. Click a segment for those leads.</p>
        <TrendChart data={d.trend} />
        <TableView
          head={[d.bucket === "month" ? "Month" : "Week of", "Open", "Quote out", "Won", "Lost / unqualified", "Total"]}
          rows={d.trend.map((t) => [
            t.label,
            ...(["open", "quote_out", "won", "lost"] as const).map((k) => <Link key={k} className="underline" href={t.hrefs[k]}>{t[k]}</Link>),
            <Link key="t" className="underline" href={t.href}>{t.total}</Link>,
          ])}
        />
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

function Card({ c, sub, alert }: { c: CardValue; sub: string; alert?: boolean }) {
  return (
    <Link href={c.href} className="card group block p-4 transition-colors hover:border-ink/40" title={c.definition} data-metric={c.key} data-value={c.numerator ? c.numerator.value : c.value}>
      <div className="text-xs tracking-wide text-muted uppercase">{c.label}</div>
      <div className={`mt-1 font-display text-3xl tabular ${alert ? "text-bloom" : ""}`}>{c.display}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </Link>
  );
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
