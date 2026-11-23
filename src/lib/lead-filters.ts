import { z } from "zod";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { leads, duplicateCandidates, EVENT_TYPES, QUALIFICATIONS, SOURCES, STATUSES } from "@/db/schema";
import type { Settings } from "./config/defaults";
import { endOfDayExclusiveInTz, startOfDayInTz } from "./dates";

/**
 * One filter model for the leads list, CSV export, bulk actions and every
 * dashboard number. URL ⇄ filter ⇄ SQL all live here, so a metric card and the
 * list it links to always run the exact same WHERE clause.
 */

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const arr = Array.isArray(v) ? v.flatMap((x) => String(x).split(",")) : String(v).split(",");
    const clean = arr.map((s) => s.trim()).filter(Boolean);
    return clean.length ? clean : undefined;
  }, z.array(item).optional());

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const flag = z.preprocess((v) => (v === "1" || v === "true" || v === true ? true : undefined), z.literal(true).optional());

export const FUNNEL_REACHED = { contacted: 1, consult: 2, consult_held: 3, proposal: 4, won: 5 } as const;

export const leadFilterSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: csv(z.enum(STATUSES)).catch(undefined),
  qualification: csv(z.enum(QUALIFICATIONS)).catch(undefined),
  source: csv(z.enum(SOURCES)).catch(undefined),
  campaign: csv(z.union([z.string().uuid(), z.literal("none")])).catch(undefined),
  event_type: csv(z.enum(EVENT_TYPES)).catch(undefined),
  owner: csv(z.union([z.string().uuid(), z.literal("unassigned"), z.literal("me")])).catch(undefined),
  band: csv(z.enum(["hot", "warm", "cold"])).catch(undefined),
  created_from: isoDate.optional().catch(undefined),
  created_to: isoDate.optional().catch(undefined),
  won_from: isoDate.optional().catch(undefined),
  won_to: isoDate.optional().catch(undefined),
  /** won or lost within the range ("decided") */
  closed_from: isoDate.optional().catch(undefined),
  closed_to: isoDate.optional().catch(undefined),
  event_from: isoDate.optional().catch(undefined),
  event_to: isoDate.optional().catch(undefined),
  event_year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  reached: z.enum(Object.keys(FUNNEL_REACHED) as [keyof typeof FUNNEL_REACHED]).optional().catch(undefined),
  follow_up: z.enum(["overdue", "today", "upcoming", "none"]).optional().catch(undefined),
  awaiting: flag.catch(undefined),
  decided: flag.catch(undefined),
  returning: flag.catch(undefined),
  has_dupes: flag.catch(undefined),
  include_merged: flag.catch(undefined),
  include_archived: flag.catch(undefined),
  import_batch: z.string().uuid().optional().catch(undefined),
});

export type LeadFilter = z.infer<typeof leadFilterSchema>;
export const FILTER_KEYS = Object.keys(leadFilterSchema.shape) as (keyof LeadFilter)[];

export const SORTABLE = {
  record_id: leads.recordId,
  name: sql`lower(coalesce(${leads.lastName}, '') || ' ' || coalesce(${leads.firstName}, ''))`,
  event_date: leads.eventDate,
  source: leads.source,
  score: leads.score,
  qualification: leads.qualification,
  status: leads.status,
  next_follow_up: leads.nextFollowUpAt,
  created: leads.createdAt,
} as const;
export type SortKey = keyof typeof SORTABLE;

export const listParamsSchema = z.object({
  sort: z.enum(Object.keys(SORTABLE) as [SortKey]).catch("created").default("created"),
  dir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  page: z.coerce.number().int().min(1).catch(1).default(1),
  per: z.coerce.number().int().min(10).max(500).catch(50).default(50),
});
export type ListParams = z.infer<typeof listParamsSchema>;

type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;
function toRecord(p: ParamsLike): Record<string, string | string[] | undefined> {
  if (p instanceof URLSearchParams) {
    const out: Record<string, string | string[]> = {};
    for (const k of new Set(p.keys())) {
      const all = p.getAll(k);
      out[k] = all.length > 1 ? all : all[0];
    }
    return out;
  }
  return p;
}

export function parseLeadFilter(p: ParamsLike): LeadFilter {
  const raw = toRecord(p);
  const picked = Object.fromEntries(FILTER_KEYS.map((k) => [k, raw[k]]));
  return leadFilterSchema.parse(picked);
}

export function parseListParams(p: ParamsLike): ListParams {
  return listParamsSchema.parse(toRecord(p));
}

/** Canonical URL params for a filter (stable key order, comma-joined arrays). */
export function filterToParams(f: LeadFilter): URLSearchParams {
  const sp = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else if (v === true) sp.set(k, "1");
    else sp.set(k, String(v));
  }
  return sp;
}

export function leadsHref(f: LeadFilter, extra: Record<string, string> = {}) {
  const sp = filterToParams(f);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `/leads?${qs}` : "/leads";
}

export interface WhereContext {
  now: Date;
  userId: string | null;
  settings: Pick<Settings, "scoring" | "followUps" | "businessHours">;
}

/** Open = not won/lost/unqualified. */
export const openLeadSql = sql`${leads.status} not in ('won', 'lost', 'unqualified')`;

/** §10: open lead whose follow-up is due, or new and untouched for 24h, or with no follow-up at all. */
export function awaitingFollowUpSql(now: Date, noContactHours: number): SQL {
  const cutoff = new Date(now.getTime() - noContactHours * 3600_000);
  return and(
    openLeadSql,
    or(
      lte(leads.nextFollowUpAt, now),
      and(eq(leads.status, "new"), isNull(leads.lastContactedAt), lte(leads.createdAt, cutoff)),
      isNull(leads.nextFollowUpAt),
    ),
  )!;
}

export function leadWhere(f: LeadFilter, wc: WhereContext): SQL {
  const tz = wc.settings.businessHours.timezone;
  const c: (SQL | undefined)[] = [];

  if (!f.include_merged) c.push(isNull(leads.duplicateOfId));
  if (!f.include_archived) c.push(isNull(leads.archivedAt));

  if (f.q) {
    const term = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    c.push(
      or(
        sql`(coalesce(${leads.firstName},'') || ' ' || coalesce(${leads.lastName},'') || ' ' || coalesce(${leads.partnerName},'')) ilike ${term}`,
        sql`${leads.email} ilike ${term}`,
        sql`${leads.phone} ilike ${term}`,
        sql`${leads.recordId} ilike ${term}`,
        sql`${leads.venueName} ilike ${term}`,
      ),
    );
  }
  if (f.status?.length) c.push(inArray(leads.status, f.status));
  if (f.qualification?.length) c.push(inArray(leads.qualification, f.qualification));
  if (f.source?.length) c.push(inArray(leads.source, f.source));
  if (f.event_type?.length) c.push(inArray(leads.eventType, f.event_type));
  if (f.campaign?.length) {
    const ids = f.campaign.filter((x) => x !== "none");
    c.push(or(ids.length ? inArray(leads.campaignId, ids) : undefined, f.campaign.includes("none") ? isNull(leads.campaignId) : undefined));
  }
  if (f.owner?.length) {
    const ids = f.owner.map((o) => (o === "me" ? wc.userId : o)).filter((o): o is string => !!o && o !== "unassigned");
    c.push(or(ids.length ? inArray(leads.ownerId, ids) : undefined, f.owner.includes("unassigned") ? isNull(leads.ownerId) : undefined));
  }
  if (f.band?.length) {
    const { hot, warm } = wc.settings.scoring.bands;
    c.push(
      or(
        ...f.band.map((b) =>
          b === "hot" ? gte(leads.score, hot) : b === "warm" ? and(gte(leads.score, warm), lt(leads.score, hot)) : lt(leads.score, warm),
        ),
      ),
    );
  }
  if (f.created_from) c.push(gte(leads.createdAt, startOfDayInTz(f.created_from, tz)));
  if (f.created_to) c.push(lt(leads.createdAt, endOfDayExclusiveInTz(f.created_to, tz)));
  if (f.won_from) c.push(gte(leads.wonAt, startOfDayInTz(f.won_from, tz)));
  if (f.won_to) c.push(lt(leads.wonAt, endOfDayExclusiveInTz(f.won_to, tz)));
  if (f.closed_from || f.closed_to) {
    const closedAt = sql`coalesce(${leads.wonAt}, ${leads.lostAt})`;
    c.push(inArray(leads.status, ["won", "lost"]));
    if (f.closed_from) c.push(sql`${closedAt} >= ${startOfDayInTz(f.closed_from, tz).toISOString()}::timestamptz`);
    if (f.closed_to) c.push(sql`${closedAt} < ${endOfDayExclusiveInTz(f.closed_to, tz).toISOString()}::timestamptz`);
  }
  if (f.event_from) c.push(gte(leads.eventDate, f.event_from));
  if (f.event_to) c.push(lte(leads.eventDate, f.event_to));
  if (f.event_year) c.push(and(gte(leads.eventDate, `${f.event_year}-01-01`), lte(leads.eventDate, `${f.event_year}-12-31`)));
  if (f.reached) c.push(gte(leads.furthestStage, FUNNEL_REACHED[f.reached]));
  if (f.decided) c.push(inArray(leads.status, ["won", "lost"]));
  if (f.returning) c.push(eq(leads.returningInquiry, true));
  if (f.import_batch) c.push(eq(leads.importBatchId, f.import_batch));
  if (f.awaiting) c.push(awaitingFollowUpSql(wc.now, wc.settings.followUps.newLeadNoContactHours));
  if (f.follow_up) {
    const todayStart = startOfDayInTz(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(wc.now), tz);
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);
    if (f.follow_up === "overdue") c.push(and(openLeadSql, lt(leads.nextFollowUpAt, wc.now)));
    if (f.follow_up === "today") c.push(and(openLeadSql, gte(leads.nextFollowUpAt, wc.now), lt(leads.nextFollowUpAt, todayEnd)));
    if (f.follow_up === "upcoming") c.push(and(openLeadSql, gte(leads.nextFollowUpAt, todayEnd)));
    if (f.follow_up === "none") c.push(and(openLeadSql, isNull(leads.nextFollowUpAt)));
  }
  if (f.has_dupes) {
    c.push(
      sql`exists (select 1 from ${duplicateCandidates} d where d.status = 'open' and (d.lead_a = ${leads.id} or d.lead_b = ${leads.id}))`,
    );
  }
  return and(...c.filter(Boolean)) ?? sql`true`;
}

/** Human summary of a filter, for headings ("Qualified · Nov 1 – Nov 30"). */
export function describeFilter(f: LeadFilter): string[] {
  const out: string[] = [];
  const h = (s: string) => s.replace(/_/g, " ");
  if (f.q) out.push(`“${f.q}”`);
  if (f.status) out.push(`status: ${f.status.map(h).join(", ")}`);
  if (f.qualification) out.push(f.qualification.map(h).join(", "));
  if (f.source) out.push(`source: ${f.source.map(h).join(", ")}`);
  if (f.event_type) out.push(f.event_type.map(h).join(", "));
  if (f.band) out.push(f.band.join(", "));
  if (f.created_from || f.created_to) out.push(`created ${f.created_from ?? "…"} → ${f.created_to ?? "…"}`);
  if (f.closed_from || f.closed_to) out.push(`won or lost ${f.closed_from ?? "…"} → ${f.closed_to ?? "…"}`);
  if (f.won_from || f.won_to) out.push(`won ${f.won_from ?? "…"} → ${f.won_to ?? "…"}`);
  if (f.event_year) out.push(`events in ${f.event_year}`);
  if (f.reached) out.push(`reached ${h(f.reached)}`);
  if (f.awaiting) out.push("awaiting follow-up");
  if (f.decided) out.push("won or lost");
  if (f.follow_up) out.push(`follow-up ${f.follow_up}`);
  if (f.returning) out.push("returning inquiries");
  if (f.has_dupes) out.push("possible duplicates");
  return out;
}

export { ne, isNotNull };
