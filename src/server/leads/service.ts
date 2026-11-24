import { and, eq, isNull, sql, asc, lte } from "drizzle-orm";
import { z } from "zod";
import type { Ctx, Tx } from "@/db/client";
import {
  leads,
  leadEvents,
  followUps,
  EVENT_TYPES,
  TIERS,
  SOURCES,
  STATUSES,
  LOST_REASONS,
  type Lead,
  type NewLead,
  type EventKind,
  type Status,
} from "@/db/schema";
import type { Settings } from "@/lib/config/defaults";
import { normalizeEmail, normalizePhone, strOrNull } from "@/lib/normalize";
import { FUNNEL_RANK, STAGE_TIMESTAMP, validateTransition, isUndoWin } from "@/lib/status";
import { getSettings } from "../settings";

/* -------------------------------------------------------------------------- */
/* Input shapes (Zod at every boundary)                                       */
/* -------------------------------------------------------------------------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().nonnegative().finite();

/** Fields a person (or integration) may set directly. */
export const leadFieldsSchema = z.object({
  firstName: z.string().trim().max(120).nullable(),
  lastName: z.string().trim().max(120).nullable(),
  partnerName: z.string().trim().max(200).nullable(),
  email: z.string().trim().max(320).nullable(),
  phone: z.string().trim().max(40).nullable(),
  eventType: z.enum(EVENT_TYPES),
  eventDate: isoDate.nullable(),
  venueName: z.string().trim().max(200).nullable(),
  venueCity: z.string().trim().max(120).nullable(),
  guestCount: z.number().int().nonnegative().nullable(),
  budgetMin: money.nullable(),
  budgetMax: money.nullable(),
  estimateTotal: money.nullable(),
  servicesRequested: z.array(z.string().trim().max(60)).max(30),
  tierInterest: z.enum(TIERS).nullable(),
  message: z.string().max(20000).nullable(),
  source: z.enum(SOURCES),
  captureChannel: z.enum(SOURCES).nullable(),
  sourceDetail: z.string().trim().max(300).nullable(),
  utmSource: z.string().max(200).nullable(),
  utmMedium: z.string().max(200).nullable(),
  utmContent: z.string().max(200).nullable(),
  utmTerm: z.string().max(200).nullable(),
  landingPage: z.string().max(2000).nullable(),
  referrerUrl: z.string().max(2000).nullable(),
  status: z.enum(STATUSES),
  lostReason: z.enum(LOST_REASONS).nullable(),
  lostReasonDetail: z.string().max(500).nullable(),
  unqualifiedReason: z.string().max(500).nullable(),
  ownerId: z.string().uuid().nullable(),
  nextFollowUpAt: z.date().nullable(),
  lastContactedAt: z.date().nullable(),
  smsOptOutAt: z.date().nullable(),
  emailOptOutAt: z.date().nullable(),
  firstReplyAt: z.date().nullable(),
  quoteValue: money.nullable(),
});
export type LeadFields = z.infer<typeof leadFieldsSchema>;
export const leadPatchSchema = leadFieldsSchema.partial();
export type LeadPatch = z.infer<typeof leadPatchSchema>;

/** Fields only internal services may set (merge, import, intake, overrides). */
export interface SystemPatch {
  duplicateOfId?: string | null;
  returningInquiry?: boolean;
  archivedAt?: Date | null;
  /** Goodshuffle project stage and number (set by the Goodshuffle sync) */
  goodshuffleStatus?: string | null;
  goodshuffleProject?: string | null;
}

export class LeadError extends Error {
  constructor(message: string, public code: "not_found" | "invalid" | "read_only" = "invalid") {
    super(message);
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const TRACKED_FIELDS = [...Object.keys(leadFieldsSchema.shape), "duplicateOfId", "returningInquiry", "archivedAt", "goodshuffleStatus", "goodshuffleProject"] as const;

/** Event type a change to a given field is recorded as. Everything else is field_changed. */
const FIELD_EVENT: Partial<Record<string, EventKind>> = {
  status: "status_changed",
  ownerId: "assigned",
  duplicateOfId: "merged",
  archivedAt: "archived",
};

export function serialize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function same(a: unknown, b: unknown) {
  return serialize(a) === serialize(b);
}

function derived(l: Pick<Lead, "email" | "phone">) {
  return { emailNormalized: normalizeEmail(l.email), phoneE164: normalizePhone(l.phone) };
}

export interface EventInput {
  type: EventKind;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  payload?: unknown;
  at?: Date;
}

export async function writeEvents(tx: Tx, ctx: Ctx, leadId: string, events: EventInput[]) {
  if (!events.length) return;
  await tx.insert(leadEvents).values(
    events.map((e) => ({
      leadId,
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorKind: ctx.actorKind,
      type: e.type,
      field: e.field ?? null,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      payload: (e.payload ?? null) as any,
      ...(e.at ? { at: e.at } : {}),
    })),
  );
}

export async function getLeadForUpdate(tx: Tx, leadId: string): Promise<Lead> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead) throw new LeadError("Lead not found", "not_found");
  return lead;
}

/* -------------------------------------------------------------------------- */
/* createLead                                                                 */
/* -------------------------------------------------------------------------- */

export interface CreateOptions {
  eventType?: "created" | "imported";
  payload?: unknown;
  importBatchId?: string | null;
  createdAt?: Date; // backfills/imports keep the original submission time
  now?: Date;
  settings?: Settings;
}

/** Insert a lead (normalized) and its `created`/`imported` event. */
export async function createLead(tx: Tx, ctx: Ctx, input: Partial<LeadFields>, opts: CreateOptions = {}): Promise<Lead> {
  const fields = leadPatchSchema.parse(input);
  const settings = opts.settings ?? (await getSettings(tx, ctx.orgId));
  const now = opts.now ?? new Date();
  const status: Status = fields.status ?? "new";

  const row: Record<string, any> = {
    ...fields,
    orgId: ctx.orgId,
    eventType: fields.eventType ?? "other",
    source: fields.source ?? "other",
    servicesRequested: fields.servicesRequested ?? [],
    status,
    createdBy: ctx.userId,
    importBatchId: opts.importBatchId ?? null,
    ...derived({ email: fields.email ?? null, phone: fields.phone ?? null }),
  };
  if (opts.createdAt) {
    row.createdAt = opts.createdAt;
    row.updatedAt = opts.createdAt;
  }
  // stage timestamps for leads that arrive mid-funnel (imports)
  const stageAt = opts.createdAt ?? now;
  applyStageEntry(row, status, stageAt);

  const [lead] = await tx.insert(leads).values(row as NewLead).returning();
  await writeEvents(tx, ctx, lead.id, [
    {
      type: opts.eventType ?? "created",
      payload: opts.payload ?? { fields },
      at: opts.createdAt,
      newValue: lead.recordId,
    },
  ]);
  return lead;
}

function applyStageEntry(row: Record<string, any>, status: Status, at: Date) {
  const rank = FUNNEL_RANK[status];
  if (rank > (row.furthestStage ?? 0)) row.furthestStage = rank;
  // entering a funnel stage implies the earlier ones happened (no earlier than now)
  const order: Status[] = ["contacted", "consult_scheduled", "consult_held", "proposal_sent", "won"];
  for (const s of order) {
    if (FUNNEL_RANK[s] <= rank) {
      const col = STAGE_TIMESTAMP[s]!;
      if (!row[col]) row[col] = at;
    }
  }
  if (status === "lost" && !row.lostAt) row.lostAt = at;
}

/* -------------------------------------------------------------------------- */
/* updateLead: the ONLY code path that updates `leads`                       */
/* -------------------------------------------------------------------------- */

export interface UpdateOptions {
  payload?: unknown;
  now?: Date;
  settings?: Settings;
  /** merge needs to write onto a lead that is about to become read-only */
  allowReadOnly?: boolean;
  /** record field changes under a specific event type (e.g. qualification override) */
  eventTypeFor?: Partial<Record<string, EventKind>>;
}

export interface UpdateResult {
  lead: Lead;
  changed: string[];
}

/**
 * Diff `patch` against the stored lead, validate status moves, save, append one
 * event per changed field. All in the
 * caller's transaction, so the change and its history commit together.
 */
export async function updateLead(
  tx: Tx,
  ctx: Ctx,
  leadId: string,
  patch: LeadPatch & SystemPatch,
  opts: UpdateOptions = {},
): Promise<UpdateResult> {
  const { duplicateOfId, returningInquiry, archivedAt, goodshuffleStatus, goodshuffleProject, ...rest } = patch;
  const fields = leadPatchSchema.parse(rest);
  const now = opts.now ?? new Date();
  const settings = opts.settings ?? (await getSettings(tx, ctx.orgId));
  const current = await getLeadForUpdate(tx, leadId);

  if (!opts.allowReadOnly && (current.duplicateOfId || current.archivedAt)) {
    throw new LeadError(
      current.duplicateOfId ? "This lead was merged into another record and is read-only" : "This lead is archived",
      "read_only",
    );
  }

  const next: Record<string, any> = { ...current };
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const set = (field: string, value: unknown) => {
    if (value === undefined || same((current as any)[field], value)) return;
    next[field] = value;
    changes.push({ field, old: (current as any)[field], new: value });
  };

  // Status first: validate + side effects
  if (fields.status && fields.status !== current.status) {
    const v = validateTransition(current.status, fields.status, {
      lostReason: fields.lostReason ?? current.lostReason,
      unqualifiedReason: fields.unqualifiedReason ?? current.unqualifiedReason,
    });
    if (!v.ok) throw new LeadError(v.error);
    if (isUndoWin(current.status, fields.status) && ctx.role !== "owner" && ctx.role !== "system")
      throw new LeadError("Only an owner can move a won lead back");
  }
  for (const [k, v] of Object.entries(fields)) set(k, v);
  set("duplicateOfId", duplicateOfId);
  set("returningInquiry", returningInquiry);
  set("archivedAt", archivedAt);

  if (next.email !== current.email || next.phone !== current.phone) {
    const d = derived(next as Lead);
    set("emailNormalized", d.emailNormalized);
    set("phoneE164", d.phoneE164);
  }

  if (fields.status && fields.status !== current.status) {
    const before = { ...next };
    applyStageEntry(next, fields.status, now);
    if (fields.status === "won") next.wonAt = now;
    if (fields.status === "lost") next.lostAt = now;
    for (const col of ["furthestStage", "contactedAt", "consultScheduledAt", "consultHeldAt", "proposalSentAt", "wonAt", "lostAt"]) {
      if (!same(before[col], next[col])) changes.push({ field: col, old: (current as any)[col], new: next[col] });
    }
    if (current.status === "won" && fields.status !== "won") set("wonAt", null);
  }

  if (goodshuffleStatus !== undefined) set("goodshuffleStatus", goodshuffleStatus);
  if (goodshuffleProject !== undefined) set("goodshuffleProject", goodshuffleProject);
  if (!changes.length) return { lead: current, changed: [] };

  const updateSet: Record<string, any> = { updatedAt: now };
  for (const c of changes) updateSet[c.field] = next[c.field];

  const [saved] = await tx.update(leads).set(updateSet).where(eq(leads.id, leadId)).returning();

  const events: EventInput[] = changes.map((c) => ({
    type:
      opts.eventTypeFor?.[c.field] ??
      FIELD_EVENT[c.field] ??
      "field_changed",
    field: c.field,
    oldValue: serialize(c.old),
    newValue: serialize(c.new),
    at: opts.now,
    payload: opts.payload ?? null,
  }));
  if (changes.some((c) => c.field === "status" && c.new === "won")) {
    const days = Math.round((now.getTime() - current.createdAt.getTime()) / 86_400_000);
    events.push({ at: opts.now, type: "converted", payload: { daysToConvert: days, quoteValue: saved.quoteValue } });
  }
  await writeEvents(tx, ctx, leadId, events);

  // closing a lead closes its open follow-ups
  if (fields.status && ["won", "lost", "unqualified", "not_reachable"].includes(fields.status) && fields.status !== current.status) {
    const open = await tx.select({ id: followUps.id }).from(followUps).where(and(eq(followUps.leadId, leadId), isNull(followUps.doneAt)));
    for (const f of open) await completeFollowUp(tx, ctx, f.id, now, { reason: `lead ${fields.status}` });
    if (open.length) {
      const [fresh] = await tx.select().from(leads).where(eq(leads.id, leadId));
      return { lead: fresh, changed: changes.map((c) => c.field) };
    }
  }
  return { lead: saved, changed: changes.map((c) => c.field) };
}

/* -------------------------------------------------------------------------- */
/* Activities, notes, follow-ups                                              */
/* -------------------------------------------------------------------------- */

export const activitySchema = z.object({
  kind: z.enum(["call", "email", "meeting", "note", "text"]),
  direction: z.enum(["outbound", "inbound"]).default("outbound"),
  summary: z.string().trim().max(10000).default(""),
  outcome: z.string().trim().max(200).optional(),
  occurredAt: z.coerce.date().optional(),
});
export type ActivityInput = z.input<typeof activitySchema>;

const ACTIVITY_EVENT = { call: "call_logged", email: "email_logged", meeting: "meeting_logged", note: "note_added", text: "text_logged" } as const;

/**
 * Log a call/email/meeting/note. Outbound contact on a `new` lead moves it to
 * `contacted`; an inbound reply after first contact counts toward engagement.
 * Any open follow-ups due by now are marked done.
 */
export async function logActivity(
  tx: Tx,
  ctx: Ctx,
  leadId: string,
  input: ActivityInput,
  nowArg?: Date,
  /**
   * closeDueBy: follow-ups due by this time are marked done (default: now + 12h). Synced history
   * (the mailbox) passes the activity's own time, or null to close none. extraPayload goes on the event.
   */
  opts: { closeDueBy?: Date | null; extraPayload?: Record<string, unknown> } = {},
) {
  const now = nowArg ?? new Date();
  const a = activitySchema.parse(input);
  const lead = await getLeadForUpdate(tx, leadId);
  if (lead.duplicateOfId || lead.archivedAt) throw new LeadError("This lead is read-only", "read_only");
  const at = a.occurredAt ?? now;

  await writeEvents(tx, ctx, leadId, [
    { at: nowArg ? at : undefined, type: ACTIVITY_EVENT[a.kind], payload: { summary: a.summary, direction: a.direction, outcome: a.outcome ?? null, occurredAt: at, ...(opts.extraPayload ?? {}) } },
  ]);

  if (a.kind === "note") return { lead };

  const patch: LeadPatch = {};
  if (a.direction === "outbound") {
    if (!lead.lastContactedAt || lead.lastContactedAt < at) patch.lastContactedAt = at;
    if (lead.status === "new") patch.status = "contacted";
  } else {
    if (!lead.firstReplyAt && (lead.lastContactedAt || lead.contactedAt)) patch.firstReplyAt = at;
  }
  const { lead: updated } = await updateLead(tx, ctx, leadId, patch, { now });

  // close follow-ups that this activity satisfied
  const closeDueBy = opts.closeDueBy === undefined ? new Date(now.getTime() + 12 * 3600_000) : opts.closeDueBy;
  if (closeDueBy) {
    const due = await tx
      .select()
      .from(followUps)
      .where(and(eq(followUps.leadId, leadId), isNull(followUps.doneAt), lte(followUps.dueAt, closeDueBy)));
    for (const f of due) await completeFollowUp(tx, ctx, f.id, now, { viaActivity: a.kind });
  }

  return { lead: updated };
}

export async function addNote(tx: Tx, ctx: Ctx, leadId: string, text: string) {
  return logActivity(tx, ctx, leadId, { kind: "note", summary: text });
}

export async function setFollowUp(
  tx: Tx,
  ctx: Ctx,
  leadId: string,
  input: { dueAt: Date; note?: string | null; ownerId?: string | null },
  now = new Date(),
) {
  const lead = await getLeadForUpdate(tx, leadId);
  const [fu] = await tx
    .insert(followUps)
    .values({ orgId: ctx.orgId, leadId, dueAt: input.dueAt, ownerId: input.ownerId ?? lead.ownerId, note: input.note ?? null })
    .returning();
  await writeEvents(tx, ctx, leadId, [
    { type: "follow_up_set", newValue: serialize(fu.dueAt), payload: { followUpId: fu.id, note: fu.note, ownerId: fu.ownerId } },
  ]);
  await syncNextFollowUp(tx, ctx, leadId, now, { followUpId: fu.id });
  return fu;
}

export async function completeFollowUp(tx: Tx, ctx: Ctx, followUpId: string, now = new Date(), payload: Record<string, unknown> = {}) {
  const [fu] = await tx
    .update(followUps)
    .set({ doneAt: now, doneBy: ctx.userId })
    .where(and(eq(followUps.id, followUpId), isNull(followUps.doneAt)))
    .returning();
  if (!fu) return null;
  await writeEvents(tx, ctx, fu.leadId, [{ type: "follow_up_done", newValue: serialize(fu.dueAt), payload: { followUpId: fu.id, note: fu.note, ...payload } }]);
  await syncNextFollowUp(tx, ctx, fu.leadId, now, { cleared: fu.id });
  return fu;
}

/** leads.next_follow_up_at = earliest open follow-up (or null). */
export async function syncNextFollowUp(tx: Tx, ctx: Ctx, leadId: string, now: Date, payload: unknown) {
  const [nextFu] = await tx
    .select({ dueAt: followUps.dueAt })
    .from(followUps)
    .where(and(eq(followUps.leadId, leadId), isNull(followUps.doneAt)))
    .orderBy(asc(followUps.dueAt))
    .limit(1);
  await updateLead(tx, ctx, leadId, { nextFollowUpAt: nextFu?.dueAt ?? null }, { now, payload, allowReadOnly: true });
}

export const cleanStr = strOrNull;
