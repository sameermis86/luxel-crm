import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { leads, type Qualification, type Source } from "@/db/schema";
import { leadWhere, leadsHref, type LeadFilter, type WhereContext } from "@/lib/lead-filters";
import { base, conversionDetail, dims, FUNNEL, metricCards, type DashFilter, type Metric } from "@/lib/metrics";
import { addDaysToDate } from "@/lib/dates";
import { countLeads } from "./leads/queries";

export interface CardValue {
  key: string;
  label: string;
  definition: string;
  value: number;
  display: string;
  href: string;
  numerator?: { value: number; href: string };
  denominator?: { value: number; href: string };
}

async function evalMetric(tx: Tx, m: Metric, wc: WhereContext): Promise<CardValue> {
  if (m.kind === "count") {
    const value = await countLeads(tx, m.filter, wc);
    return { key: m.key, label: m.label, definition: m.definition, value, display: value.toLocaleString(), href: leadsHref(m.filter) };
  }
  const [n, d] = await Promise.all([countLeads(tx, m.numerator, wc), countLeads(tx, m.denominator, wc)]);
  const pct = d ? (n / d) * 100 : 0;
  return {
    key: m.key,
    label: m.label,
    definition: m.definition,
    value: pct,
    display: d ? `${pct.toFixed(1)}%` : "—",
    href: leadsHref(m.numerator),
    numerator: { value: n, href: leadsHref(m.numerator) },
    denominator: { value: d, href: leadsHref(m.denominator) },
  };
}


export async function computeDashboard(tx: Tx, df: DashFilter, wc: WhereContext) {
  const tz = wc.settings.businessHours.timezone;
  const b = base(df);
  const bWhere = leadWhere(b, wc);

  const cards = await Promise.all(metricCards(df, wc.now, tz).map((m) => evalMetric(tx, m, wc)));
  const detail = await Promise.all(conversionDetail(df).map((m) => evalMetric(tx, m, wc)));

  // Leads by source, won overlay (won = of these leads)
  const srcRows = await tx
    .select({ source: leads.source, n: sql<number>`count(*)::int`, won: sql<number>`count(*) filter (where ${leads.status} = 'won')::int` })
    .from(leads)
    .where(bWhere)
    .groupBy(leads.source)
    .orderBy(sql`count(*) desc`);
  const bySource = srcRows.map((r) => {
    const f: LeadFilter = { ...b, source: [r.source as Source] };
    return { source: r.source, leads: r.n, won: r.won, href: leadsHref(f), wonHref: leadsHref({ ...f, status: ["won"] }) };
  });

  // Funnel
  const funnel = await Promise.all(
    FUNNEL.map(async (s) => {
      const f = s.filter(df);
      return { key: s.key, label: s.label, value: await countLeads(tx, f, wc), href: leadsHref(f) };
    }),
  );

  // Leads per week (Toronto, Monday weeks), stacked by qualification
  // the zone is inlined (validated) so SELECT and GROUP BY are the identical expression
  if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(tz)) throw new Error(`bad timezone ${tz}`);
  const weekExpr = sql<string>`to_char(date_trunc('week', ${leads.createdAt} at time zone '${sql.raw(tz)}'), 'YYYY-MM-DD')`;
  const weekRows = await tx
    .select({ week: weekExpr, q: leads.qualification, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(bWhere)
    .groupBy(weekExpr, leads.qualification)
    .orderBy(weekExpr);
  const weeksMap = new Map<string, Record<Qualification, number>>();
  for (const r of weekRows) {
    const w = weeksMap.get(r.week) ?? { qualified: 0, needs_info: 0, unqualified: 0 };
    w[r.q as Qualification] = r.n;
    weeksMap.set(r.week, w);
  }
  const weekly = [...weeksMap.entries()].map(([week, counts]) => {
    // clamp the week to the selected range so the list shows exactly this bar
    const from = week < df.from ? df.from : week;
    const end = addDaysToDate(week, 6);
    const to = end > df.to ? df.to : end;
    const wf: LeadFilter = { ...dims(df), created_from: from, created_to: to };
    return {
      week,
      label: new Date(week + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }),
      ...counts,
      total: counts.qualified + counts.needs_info + counts.unqualified,
      href: leadsHref(wf),
      hrefs: {
        qualified: leadsHref({ ...wf, qualification: ["qualified"] }),
        needs_info: leadsHref({ ...wf, qualification: ["needs_info"] }),
        unqualified: leadsHref({ ...wf, qualification: ["unqualified"] }),
      },
    };
  });

  // Quotes (revenue itself is tracked in the proposals tool)
  const quotedInRange: LeadFilter = { ...dims(df), quoted_from: df.from, quoted_to: df.to };
  const awaitingDecision: LeadFilter = { ...dims(df), status: ["proposal_sent"] };
  const [sentCount, awaitingCount] = await Promise.all([countLeads(tx, quotedInRange, wc), countLeads(tx, awaitingDecision, wc)]);
  const quotes = {
    sent: { value: sentCount, href: leadsHref(quotedInRange) },
    awaitingDecision: { value: awaitingCount, href: leadsHref(awaitingDecision) },
  };

  // Median days per stage (leads created in range)
  const med = (a: unknown, b2: unknown) =>
    sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${b2} - ${a})) / 86400) filter (where ${b2} is not null and ${a} is not null and ${b2} >= ${a})`;
  const [stages] = await tx
    .select({
      toContact: med(leads.createdAt, leads.contactedAt),
      toConsult: med(leads.contactedAt, leads.consultScheduledAt),
      toProposal: med(sql`coalesce(${leads.consultHeldAt}, ${leads.consultScheduledAt})`, leads.proposalSentAt),
      toWon: med(leads.proposalSentAt, leads.wonAt),
      createdToWon: med(leads.createdAt, leads.wonAt),
    })
    .from(leads)
    .where(bWhere);

  return { cards, detail, bySource, funnel, weekly, quotes, stages };
}

export type Dashboard = Awaited<ReturnType<typeof computeDashboard>>;
export { and };
