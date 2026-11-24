import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { leadEvents, leads, users } from "@/db/schema";
import { awaitingFollowUpSql } from "@/lib/lead-filters";
import { smsEligibility, textable, type SmsLead } from "@/lib/sms";
import type { Settings } from "@/lib/config/defaults";

/** When each lead was last texted (text_logged events). */
export async function lastTexts(tx: Tx, leadIds: string[]): Promise<Map<string, Date>> {
  if (!leadIds.length) return new Map();
  const rows = await tx
    .select({ leadId: leadEvents.leadId, at: sql<Date>`max(${leadEvents.at})`.mapWith((v) => new Date(v)) })
    .from(leadEvents)
    .where(and(eq(leadEvents.type, "text_logged"), inArray(leadEvents.leadId, leadIds)))
    .groupBy(leadEvents.leadId);
  return new Map(rows.map((r) => [r.leadId, r.at]));
}

const smsCols = {
  id: leads.id,
  recordId: leads.recordId,
  firstName: leads.firstName,
  lastName: leads.lastName,
  phoneE164: leads.phoneE164,
  status: leads.status,
  createdAt: leads.createdAt,
  smsOptOutAt: leads.smsOptOutAt,
  eventType: leads.eventType,
  eventDate: leads.eventDate,
  venueName: leads.venueName,
  nextFollowUpAt: leads.nextFollowUpAt,
  ownerName: users.name,
};
export type TextQueueRow = Awaited<ReturnType<typeof textQueue>>["rows"][number];

/**
 * Leads waiting on a follow-up that we may text now (see smsEligibility), most overdue first,
 * plus how many were left out and why.
 */
export async function textQueue(tx: Tx, now: Date, settings: Settings) {
  const candidates = await tx
    .select(smsCols)
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(isNull(leads.duplicateOfId), isNull(leads.archivedAt), isNotNull(leads.phoneE164), awaitingFollowUpSql(now, settings.followUps.newLeadNoContactHours)))
    .orderBy(sql`${leads.nextFollowUpAt} asc nulls first`, desc(leads.createdAt))
    .limit(500);
  const last = await lastTexts(tx, candidates.map((c) => c.id));
  const skipped: Record<string, number> = {};
  const rows: ((typeof candidates)[number] & { lastTextAt: Date | null })[] = [];
  for (const c of candidates) {
    const lt = last.get(c.id) ?? null;
    const e = textable(c.phoneE164) ? smsEligibility(c as SmsLead, now, settings.sms, lt) : ({ ok: false, reason: "Not a Canadian/US number" } as const);
    if (e.ok) rows.push({ ...c, lastTextAt: lt });
    else skipped[e.reason.replace(/\d+ day\(s\) ago/, "recently")] = (skipped[e.reason.replace(/\d+ day\(s\) ago/, "recently")] ?? 0) + 1;
  }
  return { rows, skipped };
}
