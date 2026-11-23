import { and, eq, isNull, ne, or, sql, inArray, type SQL } from "drizzle-orm";
import { asSystem, type Ctx, type Tx } from "@/db/client";
import { leads, duplicateCandidates, users } from "@/db/schema";
import { classifyMatch, FUZZY_NAME_THRESHOLD, type DupLead, type MatchResult } from "@/lib/duplicates";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export interface DuplicateMatch extends MatchResult {
  lead: {
    id: string;
    recordId: string;
    firstName: string | null;
    lastName: string | null;
    eventType: string;
    eventDate: string | null;
    status: string;
    ownerName: string | null;
    createdAt: Date;
  };
}

export interface DupProbe {
  id?: string;
  email?: string | null;
  emailNormalized?: string | null;
  phone?: string | null;
  phoneE164?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  partnerName?: string | null;
  eventDate?: string | null;
}

/**
 * Find existing leads that match. Runs with org-wide visibility (staff would
 * otherwise miss leads they can't open) and returns only summary fields.
 * Merged and archived leads are never candidates.
 */
export async function findDuplicates(tx: Tx, ctx: Ctx, probe: DupProbe, opts: { excludeIds?: string[] } = {}): Promise<DuplicateMatch[]> {
  const p: DupLead = {
    id: probe.id ?? "__probe__",
    emailNormalized: probe.emailNormalized ?? normalizeEmail(probe.email),
    phoneE164: probe.phoneE164 ?? normalizePhone(probe.phone),
    firstName: probe.firstName ?? null,
    lastName: probe.lastName ?? null,
    partnerName: probe.partnerName ?? null,
    eventDate: probe.eventDate ?? null,
  };
  const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim().toLowerCase();
  const ors: (SQL | undefined)[] = [];
  if (p.emailNormalized) ors.push(eq(leads.emailNormalized, p.emailNormalized));
  if (p.phoneE164) ors.push(eq(leads.phoneE164, p.phoneE164));
  if (p.eventDate) {
    ors.push(eq(leads.eventDate, p.eventDate));
    if (full)
      ors.push(
        and(
          sql`date_trunc('month', ${leads.eventDate}) = date_trunc('month', ${p.eventDate}::date)`,
          sql`similarity(app.full_name(${leads.firstName}, ${leads.lastName}), ${full}) >= ${FUZZY_NAME_THRESHOLD - 0.05}`,
        ),
      );
  }
  if (!ors.length) return [];

  const exclude = [...(opts.excludeIds ?? []), ...(probe.id ? [probe.id] : [])];
  const rows = await asSystem(tx, ctx, () =>
    tx
      .select({
        id: leads.id,
        recordId: leads.recordId,
        emailNormalized: leads.emailNormalized,
        phoneE164: leads.phoneE164,
        firstName: leads.firstName,
        lastName: leads.lastName,
        partnerName: leads.partnerName,
        eventDate: leads.eventDate,
        eventType: leads.eventType,
        status: leads.status,
        createdAt: leads.createdAt,
        ownerName: users.name,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(
        and(
          eq(leads.orgId, ctx.orgId),
          isNull(leads.duplicateOfId),
          isNull(leads.archivedAt),
          exclude.length ? sql`${leads.id} not in (${sql.join(exclude.map((e) => sql`${e}::uuid`), sql`, `)})` : undefined,
          or(...ors),
        ),
      )
      .limit(25),
  );

  const out: DuplicateMatch[] = [];
  for (const r of rows) {
    const m = classifyMatch(p, r);
    if (m)
      out.push({
        ...m,
        lead: {
          id: r.id, recordId: r.recordId, firstName: r.firstName, lastName: r.lastName, eventType: r.eventType,
          eventDate: r.eventDate, status: r.status, ownerName: r.ownerName, createdAt: r.createdAt,
        },
      });
  }
  return out.sort((a, b) => (a.confidence === b.confidence ? +a.lead.createdAt - +b.lead.createdAt : a.confidence === "high" ? -1 : 1));
}

/** Record candidate pairs (idempotent; pair stored with lead_a < lead_b). */
export async function recordDuplicateCandidates(tx: Tx, ctx: Ctx, leadId: string, matches: DuplicateMatch[]) {
  for (const m of matches) {
    const [a, b] = [leadId, m.lead.id].sort();
    await tx
      .insert(duplicateCandidates)
      .values({ orgId: ctx.orgId, leadA: a, leadB: b, matchReasons: m.reasons, confidence: m.confidence, similarity: m.similarity })
      .onConflictDoNothing();
  }
}

export async function openDuplicatesFor(tx: Tx, leadId: string) {
  return tx
    .select()
    .from(duplicateCandidates)
    .where(and(eq(duplicateCandidates.status, "open"), or(eq(duplicateCandidates.leadA, leadId), eq(duplicateCandidates.leadB, leadId))));
}

/** Nightly: re-check every live lead against the rest. */
export async function scanAllDuplicates(tx: Tx, ctx: Ctx) {
  const all = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.orgId, ctx.orgId), isNull(leads.duplicateOfId), isNull(leads.archivedAt)));
  let found = 0;
  for (const l of all) {
    const matches = await findDuplicates(tx, ctx, l);
    const before = await tx.select({ id: duplicateCandidates.id }).from(duplicateCandidates).where(or(eq(duplicateCandidates.leadA, l.id), eq(duplicateCandidates.leadB, l.id)));
    await recordDuplicateCandidates(tx, ctx, l.id, matches);
    const after = await tx.select({ id: duplicateCandidates.id }).from(duplicateCandidates).where(or(eq(duplicateCandidates.leadA, l.id), eq(duplicateCandidates.leadB, l.id)));
    found += after.length - before.length;
  }
  return { scanned: all.length, newCandidates: found };
}

export async function dismissDuplicate(tx: Tx, ctx: Ctx, candidateId: string) {
  await tx
    .update(duplicateCandidates)
    .set({ status: "dismissed", resolvedBy: ctx.userId, resolvedAt: new Date() })
    .where(eq(duplicateCandidates.id, candidateId));
}

export { inArray, ne };
