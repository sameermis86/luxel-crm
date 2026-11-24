import { and, eq, isNull, sql } from "drizzle-orm";
import { onCommit, type Ctx, type Tx } from "@/db/client";
import { followUps, intakeSubmissions, leads, type Lead, type Source } from "@/db/schema";
import { resolveSource, type IntakeForm } from "@/lib/source";
import { addBusinessHours } from "@/lib/business-hours";
import { splitFullName } from "@/lib/normalize";
import type { Settings } from "@/lib/config/defaults";
import { getSettings } from "../settings";
import { createLead, setFollowUp, updateLead, writeEvents, type LeadFields } from "./service";
import { findDuplicates, recordDuplicateCandidates, type DuplicateMatch } from "./duplicates";
import { autoAssign } from "./assignment";
import { emitJob } from "@/inngest/emit";

export type IngestInput = Partial<LeadFields> & {
  fullName?: string | null;
  explicitSource?: Source | null;
  explicitChannel?: Source | null;
};

export interface IngestOptions {
  mode: "webhook" | "manual" | "import";
  form?: IntakeForm | null;
  submissionId?: string | null;
  rawPayload?: unknown;
  importBatchId?: string | null;
  createdAt?: Date;
  /** webhook default: attach to an exact (high-confidence) match instead of creating a new lead */
  attachToExactMatch?: boolean;
  /** imports: skip the lead entirely when a high-confidence match exists */
  onDuplicate?: "create" | "skip" | "merge_blanks";
  autoFollowUp?: boolean;
  autoAssign?: boolean;
  now?: Date;
  settings?: Settings;
}

export type IngestOutcome = "created" | "attached" | "duplicate_submission" | "skipped_duplicate" | "merged_blanks";

export interface IngestResult {
  outcome: IngestOutcome;
  lead: Lead | null;
  matches: DuplicateMatch[];
}

/** Turn loose intake input into lead fields (name split, source resolution). */
export async function prepareFields(tx: Tx, ctx: Ctx, input: IngestInput, opts: Pick<IngestOptions, "form">, settings: Settings) {
  const { fullName, explicitSource, explicitChannel, ...fields } = input;
  const out: Partial<LeadFields> = { ...fields };
  if ((!out.firstName && !out.lastName) && fullName) {
    const s = splitFullName(fullName);
    out.firstName = s.firstName;
    out.lastName = s.lastName;
    if (s.partnerName && !out.partnerName) out.partnerName = s.partnerName;
  }
  const resolved = resolveSource(
    {
      explicitSource: explicitSource ?? null,
      explicitChannel: explicitChannel ?? out.captureChannel ?? null,
      utmSource: out.utmSource,
      utmMedium: out.utmMedium,
      referrerUrl: out.referrerUrl,
      form: opts.form ?? null,
    },
    settings,
  );
  out.source = resolved.source;
  out.captureChannel = resolved.captureChannel;
  return { fields: out, sourceRule: resolved.rule };
}

const FILLABLE: (keyof LeadFields)[] = [
  "firstName", "lastName", "partnerName", "email", "phone", "eventDate", "venueName", "venueCity", "guestCount",
  "budgetMin", "budgetMax", "estimateTotal", "tierInterest", "utmSource", "utmMedium", "utmCampaign",
  "utmContent", "utmTerm", "landingPage", "referrerUrl", "sourceDetail", "quoteValue",
];

/** Only fields that are blank on the existing lead. */
export function blanksOnly(existing: Lead, incoming: Partial<LeadFields>): Partial<LeadFields> {
  const patch: Record<string, unknown> = {};
  for (const k of FILLABLE) {
    const v = (incoming as any)[k];
    const cur = (existing as any)[k];
    if (v !== undefined && v !== null && v !== "" && (cur === null || cur === undefined || cur === "")) patch[k] = v;
  }
  if (existing.eventType === "other" && incoming.eventType && incoming.eventType !== "other") patch.eventType = incoming.eventType;
  if (!existing.servicesRequested?.length && incoming.servicesRequested?.length) patch.servicesRequested = incoming.servicesRequested;
  return patch as Partial<LeadFields>;
}

async function hasOpenFollowUp(tx: Tx, leadId: string) {
  const [r] = await tx.select({ id: followUps.id }).from(followUps).where(and(eq(followUps.leadId, leadId), isNull(followUps.doneAt))).limit(1);
  return !!r;
}

/**
 * The intake pipeline shared by the Wix webhook, manual entry and CSV import:
 *   idempotency → normalize → duplicate check → score → qualify → assign → first follow-up
 */
export async function ingestLead(tx: Tx, ctx: Ctx, input: IngestInput, opts: IngestOptions): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const settings = opts.settings ?? (await getSettings(tx, ctx.orgId));

  // 1. Idempotency
  if (opts.submissionId) {
    const inserted = await tx
      .insert(intakeSubmissions)
      .values({ orgId: ctx.orgId, submissionId: opts.submissionId, form: opts.form ?? opts.mode })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) {
      const [prev] = await tx
        .select({ leadId: intakeSubmissions.leadId })
        .from(intakeSubmissions)
        .where(and(eq(intakeSubmissions.orgId, ctx.orgId), eq(intakeSubmissions.submissionId, opts.submissionId)));
      const lead = prev?.leadId ? (await tx.select().from(leads).where(eq(leads.id, prev.leadId)))[0] ?? null : null;
      return { outcome: "duplicate_submission", lead, matches: [] };
    }
  }
  const linkSubmission = async (leadId: string) => {
    if (opts.submissionId)
      await tx
        .update(intakeSubmissions)
        .set({ leadId })
        .where(and(eq(intakeSubmissions.orgId, ctx.orgId), eq(intakeSubmissions.submissionId, opts.submissionId)));
  };

  // 2. Normalize + source
  const { fields, sourceRule } = await prepareFields(tx, ctx, input, opts, settings);

  // 3. Duplicate check
  const matches = await findDuplicates(tx, ctx, {
    email: fields.email,
    phone: fields.phone,
    firstName: fields.firstName,
    lastName: fields.lastName,
    partnerName: fields.partnerName,
    eventDate: fields.eventDate,
  });
  const exact = matches.find((m) => m.confidence === "high");

  if (exact) {
    const policy = opts.mode === "webhook" ? (opts.attachToExactMatch === false ? "create" : "attach") : opts.onDuplicate ?? "create";
    if (policy === "skip") return { outcome: "skipped_duplicate", lead: null, matches };
    if (policy === "attach" || policy === "merge_blanks") {
      const [existing] = await tx.select().from(leads).where(eq(leads.id, exact.lead.id));
      // a match can point at a lead that was merged meanwhile: follow to the survivor
      let target = existing;
      while (target?.duplicateOfId) [target] = await tx.select().from(leads).where(eq(leads.id, target.duplicateOfId));
      const patch = blanksOnly(target, fields);
      if (policy === "attach") {
        await writeEvents(tx, ctx, target.id, [
          {
            type: "returning_inquiry",
            payload: { form: opts.form ?? null, submissionId: opts.submissionId ?? null, matchReasons: exact.reasons, raw: opts.rawPayload ?? null, message: fields.message ?? null },
          },
        ]);
      }
      const { lead } = await updateLead(
        tx,
        ctx,
        target.id,
        { ...patch, ...(policy === "attach" ? { returningInquiry: true } : {}) },
        { now, settings, payload: { via: policy === "attach" ? "returning_inquiry" : "import_merge", importBatchId: opts.importBatchId ?? null } },
      );
      if (policy === "attach" && opts.autoFollowUp !== false && !(await hasOpenFollowUp(tx, lead.id))) {
        await setFollowUp(tx, ctx, lead.id, { dueAt: addBusinessHours(now, settings.followUps.firstResponseBusinessHours, settings.businessHours), note: "Returning inquiry: respond" }, now);
      }
      await linkSubmission(lead.id);
      if (policy === "attach") onCommit(() => emitJob("lead/returning", { orgId: ctx.orgId, leadId: lead.id }));
      return { outcome: policy === "attach" ? "attached" : "merged_blanks", lead, matches };
    }
  }

  // 4–5. Create (normalizes, scores, qualifies)
  const lead = await createLead(tx, ctx, fields, {
    eventType: opts.mode === "import" ? "imported" : "created",
    payload: {
      mode: opts.mode,
      form: opts.form ?? null,
      submissionId: opts.submissionId ?? null,
      sourceRule,
      importBatchId: opts.importBatchId ?? null,
      raw: opts.rawPayload ?? null,
    },
    importBatchId: opts.importBatchId,
    createdAt: opts.createdAt,
    now,
    settings,
  });
  await linkSubmission(lead.id);
  if (matches.length) await recordDuplicateCandidates(tx, ctx, lead.id, matches);

  // 6. Assign
  let current = lead;
  if (opts.autoAssign !== false && !lead.ownerId) {
    await autoAssign(tx, ctx, lead, settings);
    [current] = await tx.select().from(leads).where(eq(leads.id, lead.id));
  }

  // 7. First follow-up (within N business hours)
  const open = !["won", "lost", "unqualified"].includes(current.status);
  if (open && (opts.autoFollowUp ?? opts.mode !== "import")) {
    await setFollowUp(
      tx,
      ctx,
      lead.id,
      {
        dueAt: addBusinessHours(opts.createdAt ?? now, settings.followUps.firstResponseBusinessHours, settings.businessHours),
        note: "First response",
        ownerId: current.ownerId,
      },
      now,
    );
    [current] = await tx.select().from(leads).where(eq(leads.id, lead.id));
  }

  onCommit(() => emitJob("lead/created", { orgId: ctx.orgId, leadId: lead.id }));
  return { outcome: "created", lead: current, matches };
}

export const _sql = sql;
