import { and, asc, eq, isNull, lt, gte, or, sql, notInArray, desc } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { followUps, leads, users } from "@/db/schema";
import { startOfDayInTz, dateInTz } from "@/lib/dates";

const liveOpenLead = and(isNull(leads.duplicateOfId), isNull(leads.archivedAt), notInArray(leads.status, ["won", "lost", "unqualified"]));

export interface FollowUpRow {
  id: string;
  dueAt: Date;
  note: string | null;
  leadId: string;
  recordId: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  eventDate: string | null;
  score: number;
  ownerName: string | null;
}

/**
 * Open follow-ups for a user: ones assigned to them, plus unowned follow-ups on
 * leads they own. Bucketed into overdue / today / upcoming in the studio's zone.
 */
export async function myFollowUps(tx: Tx, userId: string, now: Date, tz: string) {
  const todayEnd = new Date(startOfDayInTz(dateInTz(now, tz), tz).getTime() + 86_400_000);
  const rows: FollowUpRow[] = await tx
    .select({
      id: followUps.id,
      dueAt: followUps.dueAt,
      note: followUps.note,
      leadId: leads.id,
      recordId: leads.recordId,
      firstName: leads.firstName,
      lastName: leads.lastName,
      status: leads.status,
      eventDate: leads.eventDate,
      score: leads.score,
      ownerName: users.name,
    })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(isNull(followUps.doneAt), liveOpenLead, or(eq(followUps.ownerId, userId), and(isNull(followUps.ownerId), eq(leads.ownerId, userId)))))
    .orderBy(asc(followUps.dueAt));
  return {
    overdue: rows.filter((r) => r.dueAt < now),
    today: rows.filter((r) => r.dueAt >= now && r.dueAt < todayEnd),
    upcoming: rows.filter((r) => r.dueAt >= todayEnd),
  };
}

/** My open leads with no follow-up scheduled at all (they count as awaiting follow-up). */
export async function myLeadsWithoutFollowUp(tx: Tx, userId: string) {
  return tx
    .select({ id: leads.id, recordId: leads.recordId, firstName: leads.firstName, lastName: leads.lastName, status: leads.status, createdAt: leads.createdAt, score: leads.score })
    .from(leads)
    .where(and(liveOpenLead, eq(leads.ownerId, userId), isNull(leads.nextFollowUpAt)))
    .orderBy(desc(leads.score))
    .limit(100);
}

/** New leads nobody owns (e.g. nobody was accepting leads when they arrived). */
export async function newUnassignedLeads(tx: Tx, since?: Date) {
  return tx
    .select({ id: leads.id, recordId: leads.recordId, firstName: leads.firstName, lastName: leads.lastName, createdAt: leads.createdAt, score: leads.score, eventType: leads.eventType })
    .from(leads)
    .where(and(liveOpenLead, isNull(leads.ownerId), since ? gte(leads.createdAt, since) : undefined))
    .orderBy(desc(leads.createdAt))
    .limit(50);
}

export { lt, sql };
