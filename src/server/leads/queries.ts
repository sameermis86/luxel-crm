import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import { duplicateCandidates, followUps, leadEvents, leads, users, notifications } from "@/db/schema";
import { leadWhere, SORTABLE, type LeadFilter, type ListParams, type WhereContext } from "@/lib/lead-filters";

export const listColumns = {
  id: leads.id,
  recordId: leads.recordId,
  firstName: leads.firstName,
  lastName: leads.lastName,
  partnerName: leads.partnerName,
  email: leads.email,
  phone: leads.phone,
  eventType: leads.eventType,
  eventDate: leads.eventDate,
  venueName: leads.venueName,
  source: leads.source,
  captureChannel: leads.captureChannel,
  score: leads.score,
  qualification: leads.qualification,
  status: leads.status,
  ownerId: leads.ownerId,
  ownerName: users.name,
  nextFollowUpAt: leads.nextFollowUpAt,
  createdAt: leads.createdAt,
  returningInquiry: leads.returningInquiry,
  duplicateOfId: leads.duplicateOfId,
  quoteValue: leads.quoteValue,
  budgetMin: leads.budgetMin,
  budgetMax: leads.budgetMax,
  guestCount: leads.guestCount,
};

export async function countLeads(tx: Tx, filter: LeadFilter, wc: WhereContext, extra?: SQL) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(leadWhere(filter, wc), extra));
  return r.n;
}

export async function listLeads(tx: Tx, filter: LeadFilter, wc: WhereContext, p: ListParams) {
  const where = leadWhere(filter, wc);
  const col = SORTABLE[p.sort];
  const order = p.dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
  const [rows, total] = await Promise.all([
    tx
      .select(listColumns)
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(where)
      .orderBy(order, desc(leads.recordId))
      .limit(p.per)
      .offset((p.page - 1) * p.per),
    countLeads(tx, filter, wc),
  ]);
  return { rows, total };
}

/** All matching rows (CSV export, bulk actions). Capped for safety. */
export async function allMatchingLeads(tx: Tx, filter: LeadFilter, wc: WhereContext, cap = 10000) {
  return tx
    .select(listColumns)
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(leadWhere(filter, wc))
    .orderBy(desc(leads.createdAt))
    .limit(cap);
}

export async function getLeadDetail(tx: Tx, leadId: string) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) return null;
  const owner = lead.ownerId ? (await tx.select().from(users).where(eq(users.id, lead.ownerId)))[0] ?? null : null;
  const mergedInto = lead.duplicateOfId
    ? (await tx.select({ id: leads.id, recordId: leads.recordId }).from(leads).where(eq(leads.id, lead.duplicateOfId)))[0] ?? null
    : null;
  const mergedChildren = await tx
    .select({ id: leads.id, recordId: leads.recordId, firstName: leads.firstName, lastName: leads.lastName })
    .from(leads)
    .where(eq(leads.duplicateOfId, lead.id));
  const fus = await tx
    .select({ f: followUps, ownerName: users.name })
    .from(followUps)
    .leftJoin(users, eq(users.id, followUps.ownerId))
    .where(eq(followUps.leadId, lead.id))
    .orderBy(asc(followUps.dueAt));

  const other = alias(leads, "other");
  const dups = await tx
    .select({
      d: duplicateCandidates,
      other: { id: other.id, recordId: other.recordId, firstName: other.firstName, lastName: other.lastName, eventDate: other.eventDate, eventType: other.eventType, status: other.status },
    })
    .from(duplicateCandidates)
    .innerJoin(other, or(and(eq(duplicateCandidates.leadA, lead.id), eq(other.id, duplicateCandidates.leadB)), and(eq(duplicateCandidates.leadB, lead.id), eq(other.id, duplicateCandidates.leadA))))
    .where(and(eq(duplicateCandidates.status, "open"), isNull(other.duplicateOfId)));

  return { lead, owner, mergedInto, mergedChildren, followUps: fus, duplicates: dups };
}

export type TimelineFilter = "all" | "activities" | "changes";
const ACTIVITY_TYPES = ["created", "imported", "note_added", "call_logged", "email_logged", "meeting_logged", "follow_up_set", "follow_up_done", "returning_inquiry", "merged", "converted"] as const;

/**
 * Timeline: this lead's events plus those of any leads merged into it (events
 * are never moved, so merged history is read in place).
 */
export async function getTimeline(tx: Tx, leadId: string, filter: TimelineFilter = "all") {
  const children = await tx.select({ id: leads.id }).from(leads).where(eq(leads.duplicateOfId, leadId));
  const ids = [leadId, ...children.map((c) => c.id)];
  const typeFilter =
    filter === "activities"
      ? inArray(leadEvents.type, [...ACTIVITY_TYPES])
      : filter === "changes"
        ? sql`${leadEvents.type} not in (${sql.join(ACTIVITY_TYPES.map((t) => sql`${t}`), sql`, `)})`
        : undefined;
  return tx
    .select({ e: leadEvents, actorName: users.name, recordId: leads.recordId })
    .from(leadEvents)
    .leftJoin(users, eq(users.id, leadEvents.actorId))
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .where(and(inArray(leadEvents.leadId, ids), typeFilter))
    .orderBy(desc(leadEvents.at), desc(leadEvents.seq))
    .limit(500);
}

export async function listUsers(tx: Tx) {
  return tx.select().from(users).orderBy(asc(users.name));
}


export async function unreadNotifications(tx: Tx, userId: string) {
  return tx
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
}
