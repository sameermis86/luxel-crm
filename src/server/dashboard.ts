import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { leads, type Source } from "@/db/schema";
import { leadWhere, leadsHref, type LeadFilter, type WhereContext } from "@/lib/lead-filters";
import { base, CHANNELS, dims, leadCards, nextActions, OTHER_CHANNELS, PIPELINE, quoteCards, type DashFilter, type Metric } from "@/lib/metrics";
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

  const [leadNums, quotes] = await Promise.all([
    Promise.all(leadCards(df).map((m) => evalMetric(tx, m, wc))),
    Promise.all(quoteCards(df).map((m) => evalMetric(tx, m, wc))),
  ]);

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

  // Leads per month (or week), stacked by channel
  // the zone is inlined (validated) so SELECT and GROUP BY are the identical expression
  if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(tz)) throw new Error(`bad timezone ${tz}`);
  const bucket = bucketFor(df);
  const bucketExpr = sql<string>`to_char(date_trunc('${sql.raw(bucket)}', ${leads.createdAt} at time zone '${sql.raw(tz)}'), 'YYYY-MM-DD')`;
  const rows = await tx
    .select({ period: bucketExpr, channel: leads.captureChannel, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(bWhere)
    .groupBy(bucketExpr, leads.captureChannel)
    .orderBy(bucketExpr);
  type Key = (typeof CHANNELS)[number]["key"] | "other";
  const keyOf = (c: string | null): Key => (CHANNELS.some((x) => x.key === c) ? (c as Key) : "other");
  const periods = new Map<string, Record<Key, number>>();
  for (const r of rows) {
    const p = periods.get(r.period) ?? { quote_builder: 0, contact_us_form: 0, goodshuffle: 0, other: 0 };
    p[keyOf(r.channel)] += r.n;
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
      total: counts.quote_builder + counts.contact_us_form + counts.goodshuffle + counts.other,
      href: leadsHref(pf),
      hrefs: {
        ...Object.fromEntries(CHANNELS.map((c) => [c.key, leadsHref({ ...pf, channel: [c.key as Source] })])),
        other: leadsHref({ ...pf, channel: [...OTHER_CHANNELS] }),
      } as Record<Key, string>,
    };
  });

  return { leadNums, quotes, actions, pipeline, trend, bucket };
}

export type Dashboard = Awaited<ReturnType<typeof computeDashboard>>;
