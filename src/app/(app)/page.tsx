import Link from "next/link";
import { withPage } from "@/server/page";
import { computeDashboard, type Dashboard } from "@/server/dashboard";
import { listUsers } from "@/server/leads/queries";
import { dashToParams, parseDashFilter, RANGE_LABELS, type DashFilter } from "@/lib/metrics";
import { fmtDate, titleCase } from "@/lib/format";
import { SOURCES, EVENT_TYPES } from "@/db/schema";
import { TrendChart } from "@/components/dashboard-charts";
import { C } from "@/lib/chart-colors";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Action = Dashboard["actions"][number];

const RANGE_PILLS = ["this_month", "last_30", "this_quarter", "ytd", "last_12m"] as const;
const PILL_LABEL: Record<(typeof RANGE_PILLS)[number], string> = { this_month: "Month", last_30: "30 days", this_quarter: "Quarter", ytd: "YTD", last_12m: "12 months" };

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { df, d, users, now, tz } = await withPage(async (tx, p) => {
    const tz = p.settings.businessHours.timezone;
    const df = parseDashFilter(sp, p.now, tz);
    const [d, users] = await Promise.all([computeDashboard(tx, df, p.wc), listUsers(tx)]);
    return { df, d, users, now: p.now, tz };
  });

  const one = (v?: string[]) => (v?.length === 1 ? v[0] : "");
  const rangeLabel = df.range && df.range !== "custom" ? RANGE_LABELS[df.range as keyof typeof RANGE_LABELS] : `${fmtDate(df.from)} – ${fmtDate(df.to)}`;
  const filtersOn = [df.owner, df.source, df.event_type].filter((v) => v?.length).length;
  const lead = (k: string) => d.leadNums.find((c) => c.key === k)!;
  const leadsN = lead("leads").value;
  const channels = d.leadNums.filter((c) => c.key.startsWith("ch_") && (c.key !== "ch_other" || c.value > 0));
  const quotesTotal = d.quotes.find((c) => c.key === "quotes")!;
  const stages = d.quotes.filter((c) => c.key.startsWith("q_"));
  const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
  const todo = d.actions.filter((a) => a.count > 0 && a.tone !== "quiet");
  const todoCount = todo.reduce((s, a) => s + a.count, 0);
  const quiet = d.actions.filter((a) => a.count > 0 && a.tone === "quiet");
  const pipeMax = Math.max(1, ...d.pipeline.map((p) => p.value));

  return (
    <div className="space-y-5">
      {/* Header: greeting + range */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {now.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: tz })}
          </p>
          <h1 className="mt-0.5 text-3xl">
            {todoCount ? <>{todoCount} lead{todoCount === 1 ? "" : "s"} need you today</> : "You're all caught up"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Date range" className="inline-flex rounded-md border border-edge bg-card p-0.5 text-sm">
            {RANGE_PILLS.map((r) => {
              const sp2 = dashToParams({ ...df, range: r });
              const active = df.range === r;
              return (
                <Link
                  key={r}
                  href={`/?${sp2}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded px-2.5 py-1 transition-colors duration-150 ${active ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
                >
                  {PILL_LABEL[r]}
                </Link>
              );
            })}
          </nav>
          <FilterMenu df={df} users={users} one={one} filtersOn={filtersOn} />
        </div>
      </header>

      {/* Leads: total = sum of the channels */}
      <section className="card overflow-hidden" aria-labelledby="leads-h">
        <SectionHead id="leads-h" title="Leads" note={`came in · ${rangeLabel.toLowerCase()}`} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:divide-x lg:divide-edge max-lg:[&>*]:border-b max-lg:[&>*]:border-edge">
          <Kpi c={lead("leads")} sub={channels.map((c) => c.value).join(" + ") + " by channel"} strong />
          {channels.map((c) => <Kpi key={c.key} c={c} sub={`${share(c.value, leadsN)} of leads`} swatch={C[c.key as keyof typeof C]} />)}
          <Kpi c={lead("needs_follow_up")} sub={`${share(lead("needs_follow_up").value, leadsN)} of leads`} alert />
        </div>
      </section>

      {/* Quotes: total = sent + action needed + signed + lost; each as a share of total */}
      <section className="card overflow-hidden" aria-labelledby="quotes-h">
        <SectionHead id="quotes-h" title="Quotes" note={`Goodshuffle stage of those leads · ${share(quotesTotal.value, leadsN)} of leads got a quote`} />
        <div className="grid grid-cols-2 sm:grid-cols-5 sm:divide-x sm:divide-edge max-sm:[&>*]:border-b max-sm:[&>*]:border-edge">
          <Kpi c={quotesTotal} sub={stages.map((q) => q.numerator!.value).join(" + ")} strong />
          {stages.map((q) => (
            <Kpi key={q.key} c={q} sub={`${q.numerator!.value} of ${q.denominator!.value} quotes`} swatch={C[q.key as keyof typeof C]} />
          ))}
        </div>
        {quotesTotal.value > 0 && (
          <div className="flex h-2 border-t border-edge" aria-hidden>
            {stages.map((q) => q.numerator!.value > 0 && <div key={q.key} style={{ width: `${(q.numerator!.value / quotesTotal.value) * 100}%`, background: C[q.key as keyof typeof C] }} className="border-r-2 border-card last:border-r-0" />)}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Next best actions */}
        <section className="card" aria-labelledby="actions-h">
          <div className="flex items-baseline justify-between border-b border-edge px-4 py-3">
            <h2 id="actions-h" className="text-xl">Next best actions</h2>
            <Link href="/follow-ups" className="text-sm text-muted hover:text-ink">Follow-ups →</Link>
          </div>
          {todo.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Nothing waiting. New inquiries and due follow-ups will show up here.</p>
          ) : (
            <ol className="divide-y divide-edge">
              {todo.map((a) => <ActionGroup key={a.key} a={a} now={now} tz={tz} />)}
            </ol>
          )}
          {quiet.map((a) => (
            <Link key={a.key} href={a.href} className="flex items-center justify-between gap-3 border-t border-edge bg-paper/50 px-4 py-2.5 text-sm hover:bg-paper">
              <span><span className="font-medium">{a.title}</span> <span className="text-muted">· {a.hint}</span></span>
              <span className="tabular text-muted">{a.count} →</span>
            </Link>
          ))}
        </section>

        <div className="space-y-5">
          {/* Live pipeline */}
          <section className="card p-4" aria-labelledby="pipe-h">
            <div className="flex items-baseline justify-between">
              <h2 id="pipe-h" className="text-lg">Open pipeline</h2>
              <span className="text-xs text-muted">right now</span>
            </div>
            <ul className="mt-3 space-y-2.5">
              {d.pipeline.map((p) => (
                <li key={p.key}>
                  <Link href={p.href} className="group block">
                    <div className="flex justify-between text-sm"><span className="group-hover:underline">{p.label}</span><span className="tabular">{p.value}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-paper"><div className="h-1.5 rounded-full" style={{ width: `${p.value ? Math.max(2, (p.value / pipeMax) * 100) : 0}%`, background: C.leads }} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

        </div>
      </div>

      {/* Trend */}
      <section className="card p-4" aria-labelledby="trend-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trend-h" className="text-lg">Leads per {d.bucket}</h2>
          <span className="text-xs text-muted">by channel</span>
        </div>
        <TrendChart data={d.trend} />
        <TableView
          head={[d.bucket === "month" ? "Month" : "Week of", "Quote Builder", "Contact form", "Goodshuffle", "Other", "Total"]}
          rows={d.trend.map((t) => [
            t.label,
            ...(["quote_builder", "contact_us_form", "goodshuffle", "other"] as const).map((k) => <Link key={k} className="underline" href={t.hrefs[k]}>{t[k]}</Link>),
            <Link key="t" className="underline" href={t.href}>{t.total}</Link>,
          ])}
        />
      </section>

    </div>
  );
}

const TONE = { urgent: "bg-bloom", normal: "bg-amber", quiet: "bg-muted" } as const;

function SectionHead({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-edge px-4 py-2.5">
      <h2 id={id} className="text-lg">{title}</h2>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

function Kpi({ c, sub, alert, strong, swatch }: { c: Dashboard["leadNums"][number]; sub: string; alert?: boolean; strong?: boolean; swatch?: string }) {
  return (
    <Link href={c.href} title={c.definition} data-metric={c.key} data-value={c.numerator ? c.numerator.value : c.value} className={`group block px-4 py-3.5 transition-colors duration-150 hover:bg-paper/60 ${strong ? "bg-paper/40" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {swatch && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: swatch }} aria-hidden />}
        {c.label}
      </div>
      <div className={`mt-0.5 font-display text-[28px] leading-tight tabular ${alert && c.value > 0 ? "text-bloom" : ""}`}>{c.display}</div>
      <div className="mt-0.5 truncate text-xs text-muted group-hover:text-ink">{sub}</div>
    </Link>
  );
}

function ActionGroup({ a, now, tz }: { a: Action; now: Date; tz: string }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[a.tone]}`} aria-hidden />
          <h3 className="truncate text-[15px] font-medium" style={{ fontFamily: "var(--font-sans)" }}>{a.title}</h3>
          <span className="chip border-edge text-muted tabular">{a.count}</span>
        </div>
        <Link href={a.href} className="shrink-0 text-sm text-muted hover:text-ink">{a.count > a.leads.length ? `All ${a.count}` : "Open list"} →</Link>
      </div>
      <p className="mt-0.5 pl-4 text-xs text-muted">{a.hint}</p>
      <ul className="mt-2 space-y-1 pl-4">
        {a.leads.map((l) => (
          <li key={l.id}>
            <Link href={`/leads/${l.id}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-paper">
              <Initials name={l.ownerName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {[l.firstName, l.lastName].filter(Boolean).join(" ") || "(no name)"}
                  {l.partnerName && <span className="text-muted"> &amp; {l.partnerName}</span>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {titleCase(l.eventType)}{l.eventDate ? ` · ${fmtDate(l.eventDate)}` : " · date TBD"} · {l.recordId}
                </span>
              </span>
              <span className={`shrink-0 text-xs tabular ${a.tone === "urgent" ? "text-bloom" : "text-muted"}`}>{why(a.why, l, now, tz)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

function why(kind: Action["why"], l: Action["leads"][number], now: Date, tz: string) {
  const days = (d: Date | string | null) => (d ? Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000) : null);
  const ago = (d: Date | string | null) => {
    const n = days(d);
    if (n == null) return "";
    if (n < 1) {
      const h = Math.max(1, Math.round((now.getTime() - new Date(d!).getTime()) / 3_600_000));
      return `${h}h`;
    }
    return `${n}d`;
  };
  switch (kind) {
    case "created":
      return `waiting ${ago(l.createdAt)}`;
    case "follow_up":
      if (!l.nextFollowUpAt) return "";
      return new Date(l.nextFollowUpAt) < now
        ? `${ago(l.nextFollowUpAt)} overdue`
        : `due ${new Date(l.nextFollowUpAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: tz })}`;
    case "quoted":
      return l.proposalSentAt ? `quoted ${ago(l.proposalSentAt)} ago` : "";
    case "event": {
      if (!l.eventDate) return "no event date";
      const n = Math.round((new Date(l.eventDate + "T12:00:00Z").getTime() - now.getTime()) / 86_400_000);
      return n >= 0 ? `event in ${n}d` : "event passed";
    }
  }
}

function Initials({ name }: { name: string | null }) {
  const t = name ? name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() : "—";
  return (
    <span title={name ? `Owner: ${name}` : "Unassigned"} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-medium ${name ? "bg-stem-soft text-stem" : "border border-dashed border-edge text-muted"}`}>
      {t}
    </span>
  );
}

function FilterMenu({ df, users, one, filtersOn }: { df: DashFilter; users: { id: string; name: string }[]; one: (v?: string[]) => string; filtersOn: number }) {
  return (
    <details className="relative">
      <summary className="btn cursor-pointer list-none">
        Filters{filtersOn ? <span className="chip border-ink/20 bg-ink text-paper">{filtersOn}</span> : null}
      </summary>
      <form method="get" className="card absolute right-0 z-20 mt-1 w-72 space-y-3 p-3 shadow-lg">
        {df.range !== "custom" && <input type="hidden" name="range" value={df.range} />}
        <Sel name="owner" label="Owner" value={one(df.owner)} options={[["me", "Me"], ["unassigned", "Unassigned"], ...users.map((u) => [u.id, u.name] as [string, string])]} />
        <Sel name="source" label="Source" value={one(df.source)} options={SOURCES.map((s) => [s, titleCase(s)])} />
        <Sel name="event_type" label="Event type" value={one(df.event_type)} options={EVENT_TYPES.map((s) => [s, titleCase(s)])} />
        <fieldset>
          <legend className="label">Custom dates</legend>
          <div className="flex gap-2">
            <input type="date" name="from" defaultValue={df.range === "custom" ? df.from : ""} className="input" aria-label="From" />
            <input type="date" name="to" defaultValue={df.range === "custom" ? df.to : ""} className="input" aria-label="To" />
          </div>
          <p className="mt-1 text-[11px] text-muted">Leave empty to use the range buttons.</p>
        </fieldset>
        <div className="flex justify-between">
          <Link href="/" className="btn-ghost">Reset</Link>
          <button className="btn-primary">Apply</button>
        </div>
      </form>
    </details>
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

function TableView({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs text-muted hover:text-ink">View as table</summary>
      <table className="mt-2 w-full">
        <thead><tr>{head.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-edge">
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="td tabular">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </details>
  );
}
