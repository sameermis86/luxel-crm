import { and, desc, eq, inArray, isNull, or, sql, isNotNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { leadEvents, leads, users } from "@/db/schema";
import { awaitingFollowUpSql } from "@/lib/lead-filters";
import { emailEligibility, smsEligibility, textable, type SmsLead } from "@/lib/sms";
import type { Settings } from "@/lib/config/defaults";
import { lastReminders } from "./email-reminders";

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

const cols = {
  id: leads.id,
  recordId: leads.recordId,
  firstName: leads.firstName,
  lastName: leads.lastName,
  phoneE164: leads.phoneE164,
  email: leads.emailNormalized,
  status: leads.status,
  createdAt: leads.createdAt,
  smsOptOutAt: leads.smsOptOutAt,
  emailOptOutAt: leads.emailOptOutAt,
  eventType: leads.eventType,
  eventDate: leads.eventDate,
  venueName: leads.venueName,
  nextFollowUpAt: leads.nextFollowUpAt,
  ownerName: users.name,
};
export type ReminderRow = Awaited<ReturnType<typeof reminderQueue>>["rows"][number];

/**
 * Leads waiting on a follow-up that may get a reminder now, by text and/or email (CASL rules in
 * smsEligibility / emailEligibility; spacing counts the last text or email of either kind), most
 * overdue first, plus how many were left out and why. Nothing is sent from here.
 */
export async function reminderQueue(tx: Tx, now: Date, settings: Settings) {
  const candidates = await tx
    .select(cols)
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(
      and(
        isNull(leads.duplicateOfId),
        isNull(leads.archivedAt),
        or(isNotNull(leads.phoneE164), isNotNull(leads.emailNormalized)),
        awaitingFollowUpSql(now, settings.followUps.newLeadNoContactHours),
      ),
    )
    .orderBy(sql`${leads.nextFollowUpAt} asc nulls first`, desc(leads.createdAt))
    .limit(500);
  const last = await lastReminders(tx, candidates.map((c) => c.id));
  const skipped: Record<string, number> = {};
  const rows: ((typeof candidates)[number] & { lastReminderAt: Date | null; canText: boolean; canEmail: boolean })[] = [];
  for (const c of candidates) {
    const lr = last.get(c.id) ?? null;
    const t = textable(c.phoneE164) ? smsEligibility(c as SmsLead, now, settings.sms, lr) : ({ ok: false, reason: "No Canadian/US mobile number" } as const);
    const e = emailEligibility(c, now, settings.sms, lr);
    if (t.ok || e.ok) rows.push({ ...c, lastReminderAt: lr, canText: t.ok, canEmail: e.ok });
    else {
      // the reason that matters most: consent or spacing apply to both channels
      const why = [t, e].map((x) => (x.ok ? "" : x.reason)).find((r) => /months ago|day\(s\) ago|closed|Asked not|Unsubscribed/.test(r)) ?? "No mobile number or email";
      const key = why.replace(/Texted \d+ day\(s\) ago/, "Reminded in the last few days");
      skipped[key] = (skipped[key] ?? 0) + 1;
    }
  }
  return { rows, skipped };
}
