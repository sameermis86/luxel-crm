import { and, eq, isNull, or } from "drizzle-orm";
import type { Ctx, Tx } from "@/db/client";
import { duplicateCandidates, followUps, intakeSubmissions, leads, type Lead } from "@/db/schema";
import { LeadError, updateLead, writeEvents, syncNextFollowUp, leadFieldsSchema, type LeadPatch, serialize } from "./service";

/** Fields offered in the merge tool, in display order. */
export const MERGE_FIELDS = [
  "firstName", "lastName", "partnerName", "email", "phone", "eventType", "eventDate", "venueName", "venueCity", "guestCount",
  "budgetMin", "budgetMax", "estimateTotal", "servicesRequested", "tierInterest", "message", "source", "captureChannel",
  "sourceDetail", "campaignId", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPage", "referrerUrl",
  "ownerId", "quoteValue", "contractValue", "collectedAmount",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeChoices = Partial<Record<MergeField, "survivor" | "merged">>;

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Default per-field choice: keep the survivor's value unless it's blank and the other lead has one. */
export function defaultChoices(survivor: Lead, merged: Lead): MergeChoices {
  const out: MergeChoices = {};
  for (const f of MERGE_FIELDS) out[f] = empty((survivor as any)[f]) && !empty((merged as any)[f]) ? "merged" : "survivor";
  return out;
}

/**
 * Merge `mergedId` into `survivorId`.
 *  - chosen field values are copied onto the survivor (logged as field changes)
 *  - open follow-ups move to the survivor; the merged lead's events stay where they are
 *    (lead_events is append-only) and the survivor's timeline reads them in place
 *  - the merged lead keeps its record_id, gets duplicate_of_id = survivor and becomes read-only
 *  - webhook submission ids that pointed at the merged lead now resolve to the survivor
 */
export async function mergeLeads(tx: Tx, ctx: Ctx, survivorId: string, mergedId: string, choices: MergeChoices = {}) {
  if (survivorId === mergedId) throw new LeadError("Pick two different leads");
  const [survivor] = await tx.select().from(leads).where(eq(leads.id, survivorId)).for("update");
  const [merged] = await tx.select().from(leads).where(eq(leads.id, mergedId)).for("update");
  if (!survivor || !merged) throw new LeadError("Lead not found", "not_found");
  for (const l of [survivor, merged]) {
    if (l.duplicateOfId) throw new LeadError(`${l.recordId} was already merged`, "read_only");
    if (l.archivedAt) throw new LeadError(`${l.recordId} is archived`, "read_only");
  }

  const resolved = { ...defaultChoices(survivor, merged), ...choices };
  const patch: Record<string, unknown> = {};
  for (const f of MERGE_FIELDS) if (resolved[f] === "merged") patch[f] = (merged as any)[f];
  // The furthest-along status, plus whatever it requires, carries over if the merged lead got further
  const payload = { mergedFrom: merged.id, mergedRecordId: merged.recordId };
  await updateLead(tx, ctx, survivorId, leadFieldsSchema.partial().parse(patch) as LeadPatch, { payload });

  // follow-ups
  const moved = await tx
    .update(followUps)
    .set({ leadId: survivorId })
    .where(and(eq(followUps.leadId, mergedId), isNull(followUps.doneAt)))
    .returning({ id: followUps.id });

  // repoint idempotency ledger
  await tx.update(intakeSubmissions).set({ leadId: survivorId }).where(eq(intakeSubmissions.leadId, mergedId));

  await writeEvents(tx, ctx, survivorId, [
    {
      type: "merged",
      field: null,
      newValue: merged.recordId,
      payload: { ...payload, choices: resolved, movedFollowUps: moved.length, fieldsTaken: Object.keys(patch).map((k) => ({ field: k, value: serialize((merged as any)[k]) })) },
    },
  ]);
  await updateLead(tx, ctx, mergedId, { duplicateOfId: survivorId, nextFollowUpAt: null }, { payload: { mergedInto: survivor.recordId } });
  await syncNextFollowUp(tx, ctx, survivorId, new Date(), { mergedFrom: merged.recordId });

  await tx
    .update(duplicateCandidates)
    .set({ status: "merged", resolvedBy: ctx.userId, resolvedAt: new Date() })
    .where(
      or(
        and(eq(duplicateCandidates.leadA, survivorId), eq(duplicateCandidates.leadB, mergedId)),
        and(eq(duplicateCandidates.leadA, mergedId), eq(duplicateCandidates.leadB, survivorId)),
      ),
    );

  const [fresh] = await tx.select().from(leads).where(eq(leads.id, survivorId));
  return { survivor: fresh, mergedRecordId: merged.recordId, movedFollowUps: moved.length };
}
