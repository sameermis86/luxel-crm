import { z } from "zod";
import type { SQL } from "drizzle-orm";
import { EVENT_TYPES, SOURCES, type Status } from "@/db/schema";
import { leadWhere, leadsHref, type LeadFilter, type WhereContext, FUNNEL_REACHED } from "./lead-filters";
import { addDaysToDate, dateInTz, firstOfMonthInTz, lastOfMonth } from "./dates";

/**
 * Every dashboard number is defined here, once, as a LeadFilter. From that one
 * definition we derive:
 *   - the SQL WHERE clause that counts it   (metricWhere → leadWhere)
 *   - the /leads?… URL that lists it        (metricHref  → leadsHref)
 * The leads list parses that URL back into the same LeadFilter and runs the same
 * leadWhere, so a card and the list it opens cannot drift apart. Tests assert it.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === undefined || v === "" ? undefined : String(v).split(",").filter(Boolean)), z.array(item).optional());

export const dashFilterSchema = z.object({
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  range: z.enum(["this_month", "last_month", "last_30", "this_quarter", "ytd", "last_12m", "custom"]).optional().catch(undefined),
  owner: csv(z.union([z.string().uuid(), z.literal("unassigned"), z.literal("me")])).catch(undefined),
  source: csv(z.enum(SOURCES)).catch(undefined),
  event_type: csv(z.enum(EVENT_TYPES)).catch(undefined),
});
export type DashFilter = z.infer<typeof dashFilterSchema> & { from: string; to: string };

export const RANGE_LABELS = {
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  this_quarter: "This quarter",
  ytd: "Year to date",
  last_12m: "Last 12 months",
} as const;

export function rangeDates(range: keyof typeof RANGE_LABELS, now: Date, tz: string): { from: string; to: string } {
  const today = dateInTz(now, tz);
  const first = firstOfMonthInTz(now, tz);
  switch (range) {
    case "this_month":
      return { from: first, to: lastOfMonth(first) };
    case "last_month": {
      const prev = addDaysToDate(first, -1);
      return { from: prev.slice(0, 8) + "01", to: prev };
    }
    case "last_30":
      return { from: addDaysToDate(today, -29), to: today };
    case "this_quarter": {
      const [y, m] = today.split("-").map(Number);
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      const from = `${y}-${String(qm).padStart(2, "0")}-01`;
      return { from, to: lastOfMonth(`${y}-${String(qm + 2).padStart(2, "0")}-01`) };
    }
    case "ytd":
      return { from: today.slice(0, 4) + "-01-01", to: today };
    case "last_12m":
      return { from: addDaysToDate(today, -364), to: today };
  }
}

/** Parse dashboard query params; default range = last 12 months (Toronto). */
export function parseDashFilter(p: Record<string, string | string[] | undefined>, now: Date, tz: string): DashFilter {
  const raw = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
  const f = dashFilterSchema.parse(raw);
  let { from, to } = f;
  const range = f.range ?? (from || to ? "custom" : "last_12m");
  if (range !== "custom") ({ from, to } = rangeDates(range, now, tz));
  from ??= firstOfMonthInTz(now, tz);
  to ??= dateInTz(now, tz);
  if (from > to) [from, to] = [to, from];
  return { ...f, range, from, to };
}

export function dashToParams(df: DashFilter) {
  const sp = new URLSearchParams();
  if (df.range && df.range !== "custom") sp.set("range", df.range);
  else {
    sp.set("from", df.from);
    sp.set("to", df.to);
  }
  for (const k of ["owner", "source", "event_type"] as const) if (df[k]?.length) sp.set(k, df[k]!.join(","));
  return sp;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/** The dimension filters (owner/source/event type) with no date range. */
export function dims(df: DashFilter): LeadFilter {
  return { owner: df.owner, source: df.source, event_type: df.event_type };
}

/** Leads created in the selected range + dimension filters. */
export function base(df: DashFilter): LeadFilter {
  return { ...dims(df), created_from: df.from, created_to: df.to };
}

export interface CountMetric {
  key: string;
  label: string;
  definition: string;
  kind: "count";
  filter: LeadFilter;
}
export interface RatioMetric {
  key: string;
  label: string;
  definition: string;
  kind: "ratio";
  numerator: LeadFilter;
  denominator: LeadFilter;
  /** how to read the fraction under the %: "{n} won of {d} decided" */
  nouns: [string, string];
}
export type Metric = CountMetric | RatioMetric;

/**
 * Every "in range" number is about the same group of leads: those that came in during
 * the range, counted by where they stand now. Dates of later status changes are not
 * used, because synced statuses (Goodshuffle) are stamped with the day they synced,
 * not the day the client signed. A cohort count can never exceed 100% of its leads.
 */
export function metricCards(df: DashFilter): Metric[] {
  const b = base(df);
  return [
    { key: "leads", label: "Leads", definition: "Leads that came in during the range (merged duplicates and undone imports excluded).", kind: "count", filter: b },
    { key: "quoted", label: "Got a quote", definition: "Of those leads, how many have reached Proposal sent or Won.", kind: "count", filter: { ...b, reached: "proposal" } },
    { key: "won", label: "Won", definition: "Of those leads, how many are Won now.", kind: "count", filter: { ...b, status: ["won"] } },
    {
      key: "win_rate",
      label: "Win rate",
      definition: "Of those leads that have a decision, the share that was won: won ÷ (won + lost).",
      kind: "ratio",
      numerator: { ...b, status: ["won"] },
      denominator: { ...b, status: ["won", "lost"] },
      nouns: ["won", "decided"],
    },
  ];
}

/** Numbers about today, whatever the date range. */
export function nowCards(df: DashFilter): Metric[] {
  return [
    { key: "awaiting", label: "Needs follow-up", definition: "Open leads whose follow-up is due, new leads not contacted within 24h, or open leads with no follow-up set.", kind: "count", filter: { ...dims(df), awaiting: true } },
    { key: "awaiting_decision", label: "Quote out, no decision", definition: "Leads in Proposal sent right now.", kind: "count", filter: { ...dims(df), status: ["proposal_sent"] } },
  ];
}

/** Where each lead stands now, in four groups (the trend chart's stacks). */
export const OUTCOMES = [
  { key: "open", label: "Open", statuses: ["new", "contacted", "consult_scheduled", "consult_held", "on_hold"] },
  { key: "quote_out", label: "Quote out", statuses: ["proposal_sent"] },
  { key: "won", label: "Won", statuses: ["won"] },
  { key: "lost", label: "Lost / unqualified", statuses: ["lost", "unqualified"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly Status[] }[];
export type OutcomeKey = (typeof OUTCOMES)[number]["key"];

export const FUNNEL = [
  { key: "new", label: "Came in", filter: (df: DashFilter): LeadFilter => base(df) },
  { key: "contacted", label: "Contacted", filter: (df: DashFilter): LeadFilter => ({ ...base(df), reached: "contacted" }) },
  { key: "consult", label: "Consult", filter: (df: DashFilter): LeadFilter => ({ ...base(df), reached: "consult" }) },
  { key: "proposal", label: "Proposal", filter: (df: DashFilter): LeadFilter => ({ ...base(df), reached: "proposal" }) },
  { key: "won", label: "Won", filter: (df: DashFilter): LeadFilter => ({ ...base(df), reached: "won" }) },
] as const;

export const metricWhere = (f: LeadFilter, wc: WhereContext): SQL => leadWhere(f, wc);
export const metricHref = (f: LeadFilter) => leadsHref(f);

export { FUNNEL_REACHED };
