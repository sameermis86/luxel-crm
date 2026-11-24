import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { leads, type Source, type Status } from "@/db/schema";
import { leadWhere, leadsHref, type LeadFilter, type WhereContext } from "@/lib/lead-filters";
import { base, dims, FUNNEL, metricCards, nextActions, OUTCOMES, PIPELINE, type DashFilter, type Metric, type OutcomeKey } from "@/lib/metrics";
import { addDaysToDate, lastOfMonth } from "@/lib/dates";
import { countLeads, listLeads } from "./leads/queries";

export interface CardValue {
  key: string;
  label: string;
  definition: string;
  value: number;
  display: string;
  href: string;
  numerator?: { value: number; href: string };
  denominator?: { value: number; href: string };
  nouns?: [string, string];
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
    display: d ? `${pct.toFixed(0)}%` : "—",
    href: leadsHref(m.numerator),
    numerator: { value: n, href: leadsHref(m.numerator) },
    denominator: { value: d, href: leadsHref(m.denominator) },
    nouns: m.nouns,
  };
}

/** Ranges longer than ~3 months are bucketed by month, shorter ones by week. */
export const bucketFor = (df: DashFilter): "month" | "week" => (addDaysToDate(df.from, 92) < df.to ? "month" : "week");

export async function computeDashboard(tx: Tx, df: DashFilter, wc: WhereContext) {
  const tz = wc.settings.businessHours.timezone;
  const b = base(df);
  const bWhere = leadWhere(b, wc);

  const cards = await Promise.all(metricCards(df).map((m) => evalMetric(tx, m, wc)));

  // Next best actions: count + the first few leads, oldest problem first
  const actions = await Promise.all(
    nextActions(df, wc.now, tz, wc.settings.followUps).map(async (a) => {
      const { rows, total } = await listLeads(tx, a.filter, wc, { ...a.sort, page: 1, per: 4 });
      return {
        key: a.key, title: a.title, hint: a.hint, tone: a.tone, why: a.why, count: total, href: leadsHref(a.filter, a.sort),
        leads: rows.map((r) => ({
          id: r.id, recordId: r.recordId, firstName: r.firstName, lastName: r.lastName, partnerName: r.partnerName,
          eventType: r.eventType, eventDate: r.eventDate, ownerName: r.ownerName, status: r.status,
          createdAt: r.createdAt, nextFollowUpAt: r.nextFollowUpAt, proposalSentAt: r.proposalSentAt,
        })),
      };
    }),
  );

  // Live pipeline by stage
  const pipeline = await Promise.all(
    PIPELINE.map(async (p) => {
      const f: LeadFilter = { ...dims(df), status: p.statuses };
      return { key: p.key, label: p.label, value: await countLeads(tx, f, wc), href: leadsHref(f) };
    }),
  );

  // Leads by source, and how many of them are won now
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

  // Funnel: leads that came in during the range, by the furthest stage they reached
  const funnel = await Promise.all(
    FUNNEL.map(async (s) => {
      const f = s.filter(df);
      return { key: s.key, label: s.label, value: await countLeads(tx, f, wc), href: leadsHref(f) };
    }),
  );

  // Leads per month (or week), stacked by where they stand now
  // the zone is inlined (validated) so SELECT and GROUP BY are the identical expression
  if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(tz)) throw new Error(`bad timezone ${tz}`);
  const bucket = bucketFor(df);
  const bucketExpr = sql<string>`to_char(date_trunc('${sql.raw(bucket)}', ${leads.createdAt} at time zone '${sql.raw(tz)}'), 'YYYY-MM-DD')`;
  const rows = await tx
    .select({ period: bucketExpr, status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(bWhere)
    .groupBy(bucketExpr, leads.status)
    .orderBy(bucketExpr);
  const groupOf = new Map<Status, OutcomeKey>(OUTCOMES.flatMap((o) => o.statuses.map((s) => [s as Status, o.key] as const)));
  const periods = new Map<string, Record<OutcomeKey, number>>();
  for (const r of rows) {
    const p = periods.get(r.period) ?? { open: 0, quote_out: 0, won: 0, lost: 0 };
    p[groupOf.get(r.status as Status)!] += r.n;
    periods.set(r.period, p);
  }
  const trend = [...periods.entries()].map(([start, counts]) => {
    // clamp the period to the selected range so the list shows exactly this bar
    const from = start < df.from ? df.from : start;
    const end = bucket === "month" ? lastOfMonth(start) : addDaysToDate(start, 6);
    const to = end > df.to ? df.to : end;
    const pf: LeadFilter = { ...dims(df), created_from: from, created_to: to };
    const d = new Date(start + "T12:00:00Z");
    return {
      period: start,
      label: bucket === "month"
        ? d.toLocaleDateString("en-CA", { month: "short", year: "2-digit", timeZone: "UTC" })
        : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }),
      ...counts,
      total: counts.open + counts.quote_out + counts.won + counts.lost,
      href: leadsHref(pf),
      hrefs: Object.fromEntries(OUTCOMES.map((o) => [o.key, leadsHref({ ...pf, status: [...o.statuses] })])) as Record<OutcomeKey, string>,
    };
  });

  return { cards, actions, pipeline, bySource, funnel, trend, bucket };
}

export type Dashboard = Awaited<ReturnType<typeof computeDashboard>>;
