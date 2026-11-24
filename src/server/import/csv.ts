import { and, eq, inArray, isNull, sql, gt } from "drizzle-orm";
import type { Ctx, Tx } from "@/db/client";
import { asSystem } from "@/db/client";
import { importBatches, leadEvents, leads, type Source } from "@/db/schema";
import { parseRow, LEAD_IMPORT_STATUSES, type Mapping, type ParsedRow, type Preset } from "@/lib/csv-import";
import { getSettings } from "../settings";
import { findDuplicates, type DuplicateMatch } from "../leads/duplicates";
import { prepareFields, blanksOnly } from "../leads/intake";
import { createLead, updateLead, writeEvents, LeadError } from "../leads/service";

export interface ImportOptions {
  fileName: string;
  mapping: Mapping;
  preset?: Preset;
  defaultSource?: Source | null;
  onDuplicate: "skip" | "merge_blanks";
}

export interface PreviewRow {
  rowNumber: number;
  name: string;
  status: "new" | "duplicate" | "already_imported" | "error";
  reasons: string[];
  match?: { id: string; recordId: string; name: string; eventDate: string | null; confidence: string; reasons: string[] };
}

export interface Preview {
  total: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: PreviewRow[];
}

const nameOf = (r: ParsedRow) => [r.input.firstName, r.input.lastName].filter(Boolean).join(" ") || String(r.input.email ?? r.input.phone ?? "(no name)");

/** A match counts as "the same person" for imports if it's exact, or a medium match with the same full name. */
function decisiveMatch(r: ParsedRow, matches: DuplicateMatch[]) {
  const exact = matches.find((m) => m.confidence === "high");
  if (exact) return exact;
  const full = nameOf(r).toLowerCase();
  return matches.find((m) => [m.lead.firstName, m.lead.lastName].filter(Boolean).join(" ").toLowerCase() === full && m.reasons.length > 0);
}

async function alreadyImported(tx: Tx, ctx: Ctx, hashes: string[]) {
  if (!hashes.length) return new Map<string, string>();
  const rows = await asSystem(tx, ctx, () =>
    tx
      .select({ hash: sql<string>`${leadEvents.payload}->>'rowHash'`, leadId: leadEvents.leadId })
      .from(leadEvents)
      .innerJoin(leads, eq(leads.id, leadEvents.leadId))
      .where(
        and(
          eq(leadEvents.orgId, ctx.orgId),
          eq(leadEvents.type, "imported"),
          isNull(leads.archivedAt),
          inArray(sql`${leadEvents.payload}->>'rowHash'`, hashes),
        ),
      ),
  );
  return new Map(rows.map((r) => [r.hash, r.leadId]));
}

interface Classified {
  row: ParsedRow;
  kind: PreviewRow["status"];
  match?: DuplicateMatch;
  reasons: string[];
}

async function classify(tx: Tx, ctx: Ctx, raws: Record<string, string>[], opts: ImportOptions): Promise<Classified[]> {
  const parsed = raws.map((raw, i) => parseRow(raw, i + 1, opts.mapping, { preset: opts.preset, defaultSource: opts.defaultSource }));
  const imported = await alreadyImported(tx, ctx, parsed.map((p) => p.rowHash));
  const seenInFile = new Map<string, number>();
  const out: Classified[] = [];
  for (const row of parsed) {
    if (row.errors.length) {
      out.push({ row, kind: "error", reasons: row.errors });
      continue;
    }
    if (imported.has(row.rowHash)) {
      out.push({ row, kind: "already_imported", reasons: ["This exact row was imported before"] });
      continue;
    }
    const fileKey = String(row.input.email ?? "").toLowerCase() || String(row.input.phone ?? "") || `${nameOf(row).toLowerCase()}|${row.input.eventDate ?? ""}`;
    if (seenInFile.has(fileKey)) {
      out.push({ row, kind: "duplicate", reasons: [`Same person as row ${seenInFile.get(fileKey)} in this file`] });
      continue;
    }
    seenInFile.set(fileKey, row.rowNumber);
    const matches = await findDuplicates(tx, ctx, {
      email: row.input.email as string | undefined,
      phone: row.input.phone as string | undefined,
      firstName: row.input.firstName as string | undefined,
      lastName: row.input.lastName as string | undefined,
      partnerName: row.input.partnerName as string | undefined,
      eventDate: row.input.eventDate as string | undefined,
    });
    const m = decisiveMatch(row, matches);
    if (m) out.push({ row, kind: "duplicate", match: m, reasons: m.reasons });
    else out.push({ row, kind: "new", reasons: [] });
  }
  return out;
}

export async function previewImport(tx: Tx, ctx: Ctx, raws: Record<string, string>[], opts: ImportOptions): Promise<Preview> {
  const c = await classify(tx, ctx, raws, opts);
  return {
    total: c.length,
    newCount: c.filter((x) => x.kind === "new").length,
    duplicateCount: c.filter((x) => x.kind === "duplicate" || x.kind === "already_imported").length,
    errorCount: c.filter((x) => x.kind === "error").length,
    rows: c.map((x) => ({
      rowNumber: x.row.rowNumber,
      name: nameOf(x.row),
      status: x.kind,
      reasons: x.reasons,
      match: x.match
        ? {
            id: x.match.lead.id,
            recordId: x.match.lead.recordId,
            name: [x.match.lead.firstName, x.match.lead.lastName].filter(Boolean).join(" "),
            eventDate: x.match.lead.eventDate,
            confidence: x.match.confidence,
            reasons: x.match.reasons,
          }
        : undefined,
    })),
  };
}

export interface CommitResult {
  batchId: string;
  created: number;
  merged: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

/** Create the batch and import. Every imported lead gets an `imported` event linked to the batch. */
export async function commitImport(tx: Tx, ctx: Ctx, raws: Record<string, string>[], opts: ImportOptions): Promise<CommitResult> {
  const settings = await getSettings(tx, ctx.orgId);
  const classified = await classify(tx, ctx, raws, opts);
  const importCtx: Ctx = { ...ctx, actorKind: "import" };
  const [batch] = await tx
    .insert(importBatches)
    .values({ orgId: ctx.orgId, fileName: opts.fileName, source: opts.defaultSource ?? null, preset: opts.preset?.id ?? null, rowCount: raws.length, createdBy: ctx.userId })
    .returning();

  let created = 0;
  let merged = 0;
  let skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (const c of classified) {
    const r = c.row;
    if (c.kind === "error") {
      errors.push({ row: r.rowNumber, reason: c.reasons.join("; ") });
      continue;
    }
    if (c.kind === "already_imported" || (c.kind === "duplicate" && (opts.onDuplicate === "skip" || !c.match))) {
      skipped++;
      continue;
    }
    const at = r.createdAt ?? new Date();
    const basePayload = { importBatchId: batch.id, rowNumber: r.rowNumber, rowHash: r.rowHash, row: r.raw };
    try {
      await tx.transaction(async (sp) => {
        const { fields } = await prepareFields(sp, importCtx, { ...(r.input as any), explicitSource: r.explicitSource }, {}, settings);
        if (c.kind === "duplicate" && c.match) {
          // merge: fill blanks only, on the surviving record
          let targetId = c.match.lead.id;
          const [target] = await sp.select().from(leads).where(eq(leads.id, targetId));
          if (target.duplicateOfId) targetId = target.duplicateOfId;
          const [t] = await sp.select().from(leads).where(eq(leads.id, targetId));
          const patch = blanksOnly(t, fields);
          await writeEvents(sp, importCtx, targetId, [{ type: "imported", payload: { ...basePayload, mergedInto: true, fields: Object.keys(patch) } }]);
          await updateLead(sp, importCtx, targetId, patch, { settings, payload: { importBatchId: batch.id, via: "import_merge" } });
          merged++;
          return;
        }
        const plan = LEAD_IMPORT_STATUSES(r.stage);
        const lead = await createLead(sp, importCtx, { ...fields, status: plan.create }, {
          eventType: "imported",
          payload: basePayload,
          importBatchId: batch.id,
          createdAt: at,
          now: at,
          settings,
        });
        if (plan.then) {
          await updateLead(sp, importCtx, lead.id, { status: "lost", lostReason: plan.then.lostReason ?? "other", lostReasonDetail: plan.then.lostDetail ?? null }, { now: at, settings, payload: { importBatchId: batch.id } });
        }
        created++;
      });
    } catch (e: any) {
      errors.push({ row: r.rowNumber, reason: e instanceof LeadError ? e.message : e?.cause?.message ?? e?.message ?? String(e) });
    }
  }

  await tx
    .update(importBatches)
    .set({ created, merged, duplicatesSkipped: skipped, errors })
    .where(eq(importBatches.id, batch.id));
  return { batchId: batch.id, created, merged, skipped, errors };
}

const EDIT_TYPES = ["note_added", "call_logged", "email_logged", "meeting_logged", "text_logged", "follow_up_set", "follow_up_done", "status_changed", "field_changed", "assigned", "merged", "returning_inquiry"] as const;

/** Edited since import = any user/webhook activity on a lead from this batch after the batch ran. */
export async function batchEditedLeads(tx: Tx, ctx: Ctx, batchId: string) {
  const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch) throw new LeadError("Import not found", "not_found");
  const created = await tx.select({ id: leads.id }).from(leads).where(eq(leads.importBatchId, batchId));
  const mergedTargets = await tx
    .select({ id: leadEvents.leadId })
    .from(leadEvents)
    .where(and(eq(leadEvents.type, "imported"), sql`${leadEvents.payload}->>'importBatchId' = ${batchId}`, sql`(${leadEvents.payload}->>'mergedInto')::boolean is true`));
  const ids = [...new Set([...created.map((c) => c.id), ...mergedTargets.map((m) => m.id)])];
  if (!ids.length) return { batch, ids, edited: [] as string[] };
  const edited = await asSystem(tx, ctx, () =>
    tx
      .selectDistinct({ id: leadEvents.leadId })
      .from(leadEvents)
      .where(
        and(
          inArray(leadEvents.leadId, ids),
          gt(leadEvents.at, new Date(batch.createdAt.getTime() + 1000)),
          sql`${leadEvents.actorKind} in ('user', 'webhook')`,
          inArray(leadEvents.type, [...EDIT_TYPES]),
        ),
      ),
  );
  return { batch, ids, edited: edited.map((e) => e.id) };
}

/**
 * Undo: archive the leads the batch created (never deleted, so record IDs and
 * history survive) and revert blank-fills it made on existing leads.
 */
export async function undoImport(tx: Tx, ctx: Ctx, batchId: string) {
  const { batch, edited } = await batchEditedLeads(tx, ctx, batchId);
  if (batch.undoneAt) throw new LeadError("This import was already undone");
  if (edited.length) throw new LeadError(`Can't undo: ${edited.length} lead${edited.length === 1 ? " was" : "s were"} edited after the import`);
  const now = new Date();
  const created = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.importBatchId, batchId), isNull(leads.archivedAt)));
  for (const l of created) {
    await updateLead(tx, ctx, l.id, { archivedAt: now }, { now, payload: { importBatchId: batchId, reason: "import undone" } });
  }
  // revert fields filled by merge-mode rows
  const fills = await tx
    .select()
    .from(leadEvents)
    .where(and(eq(leadEvents.type, "field_changed"), sql`${leadEvents.payload}->>'importBatchId' = ${batchId}`, sql`${leadEvents.payload}->>'via' = 'import_merge'`));
  const byLead = new Map<string, Record<string, null>>();
  for (const f of fills) {
    if (!f.field || f.oldValue !== null) continue;
    if (["emailNormalized", "phoneE164"].includes(f.field)) continue;
    byLead.set(f.leadId, { ...(byLead.get(f.leadId) ?? {}), [f.field]: null });
  }
  for (const [leadId, patch] of byLead) {
    await updateLead(tx, ctx, leadId, patch as any, { now, payload: { importBatchId: batchId, reason: "import undone" } });
  }
  await tx.update(importBatches).set({ undoneAt: now, undoneBy: ctx.userId }).where(eq(importBatches.id, batchId));
  return { archived: created.length, reverted: byLead.size };
}
