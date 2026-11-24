"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCtx } from "@/db/client";
import { SOURCES } from "@/db/schema";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";
import { previewImport, commitImport, undoImport, type Preview, type CommitResult } from "@/server/import/csv";
import { autoMap, IMPORT_FIELDS, PRESETS, type ImportField } from "@/lib/csv-import";
import { LeadError } from "@/server/leads/service";

const fieldKeys = Object.keys(IMPORT_FIELDS) as [ImportField, ...ImportField[]];
const payloadSchema = z.object({
  fileName: z.string().max(255),
  rows: z.array(z.record(z.string(), z.string().max(20000))).max(20000),
  mapping: z.record(z.string(), z.enum(fieldKeys)),
  presetId: z.string().nullable(),
  defaultSource: z.enum(SOURCES).nullable(),
  onDuplicate: z.enum(["skip", "merge_blanks"]),
});
export type ImportPayload = z.infer<typeof payloadSchema>;

type R<T> = { ok: true; data: T } | { ok: false; error: string };

async function guard<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e: any) {
    if (e instanceof LeadError || e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "The file couldn't be read: " + e.issues[0]?.message };
    console.error(e);
    return { ok: false, error: "Import failed. Nothing was changed." };
  }
}

export async function suggestMappingAction(headers: string[]) {
  await requireSession();
  const preset = Object.values(PRESETS).find((p) => Object.keys(p.mapping).every((h) => headers.includes(h)));
  return { mapping: preset ? { ...autoMap(headers), ...preset.mapping } : autoMap(headers), presetId: preset?.id ?? null };
}

export async function previewImportAction(payload: ImportPayload): Promise<R<Preview>> {
  const session = await requireSession();
  return guard(async () => {
    authorize(session, "imports:create");
    const p = payloadSchema.parse(payload);
    const ctx = ctxFor(session);
    return withCtx(ctx, (tx) =>
      previewImport(tx, ctx, p.rows, { fileName: p.fileName, mapping: p.mapping, preset: p.presetId ? PRESETS[p.presetId] : undefined, defaultSource: p.defaultSource, onDuplicate: p.onDuplicate }),
    );
  });
}

export async function commitImportAction(payload: ImportPayload): Promise<R<CommitResult>> {
  const session = await requireSession();
  const res = await guard(async () => {
    authorize(session, "imports:create");
    const p = payloadSchema.parse(payload);
    const ctx = ctxFor(session);
    return withCtx(ctx, (tx) =>
      commitImport(tx, ctx, p.rows, { fileName: p.fileName, mapping: p.mapping, preset: p.presetId ? PRESETS[p.presetId] : undefined, defaultSource: p.defaultSource, onDuplicate: p.onDuplicate }),
    );
  });
  revalidatePath("/imports");
  revalidatePath("/leads");
  return res;
}

export async function undoImportAction(batchId: string): Promise<R<{ archived: number; reverted: number }>> {
  const session = await requireSession();
  const res = await guard(async () => {
    authorize(session, "imports:undo");
    const ctx = ctxFor(session);
    return withCtx(ctx, (tx) => undoImport(tx, ctx, z.string().uuid().parse(batchId)));
  });
  revalidatePath("/imports");
  revalidatePath("/leads");
  return res;
}

export async function syncWixNowAction(): Promise<R<{ created: number; attached: number }>> {
  const session = await requireSession();
  const res = await guard(async () => {
    authorize(session, "imports:create");
    const apiKey = process.env.WIX_API_KEY;
    const siteId = process.env.WIX_SITE_ID;
    if (!apiKey || !siteId) throw new LeadError("Wix sync isn't connected (WIX_API_KEY missing)");
    const { runWixSync, wixRestClient } = await import("@/server/intake/wix-sync");
    const r = await runWixSync(session.orgId, wixRestClient(apiKey, siteId));
    return { created: r.created, attached: r.attached };
  });
  revalidatePath("/imports");
  revalidatePath("/leads");
  return res;
}

/* ----------------------------- Goodshuffle --------------------------------- */

export async function goodshuffleRunAction(mode: "preview" | "apply", onlyExact = false): Promise<R<{ changes: number; applied: number; unmatched: number }>> {
  const session = await requireSession();
  const res = await guard(async () => {
    authorize(session, mode === "apply" ? "settings:manage" : "imports:create");
    const { runGoodshuffleSync, configuredCalendars } = await import("@/server/integrations/goodshuffle");
    if (!Object.keys(configuredCalendars()).length) throw new LeadError("No Goodshuffle calendars configured yet");
    const s = await runGoodshuffleSync(session.orgId, { mode, onlyExact });
    return { changes: s.changes?.length ?? 0, applied: s.changes?.filter((c) => c.applied).length ?? 0, unmatched: s.unmatched?.length ?? 0 };
  });
  revalidatePath("/imports");
  revalidatePath("/leads");
  return res;
}

export async function goodshuffleAutoApplyAction(on: boolean): Promise<R<{ autoApply: boolean }>> {
  const session = await requireSession();
  const res = await guard(async () => {
    authorize(session, "settings:manage");
    const { setGsAutoApply } = await import("@/server/integrations/goodshuffle");
    await setGsAutoApply(session.orgId, on);
    return { autoApply: on };
  });
  revalidatePath("/imports");
  return res;
}
