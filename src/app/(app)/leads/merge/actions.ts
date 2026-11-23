"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCtx } from "@/db/client";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";
import { mergeLeads, MERGE_FIELDS } from "@/server/leads/merge";
import { LeadError } from "@/server/leads/service";

const choicesSchema = z.record(z.enum(MERGE_FIELDS), z.enum(["survivor", "merged"]));

export async function mergeLeadsAction(survivorId: string, mergedId: string, choices: Record<string, string>) {
  const session = await requireSession();
  try {
    authorize(session, "leads:merge");
    const ctx = ctxFor(session);
    const r = await withCtx(ctx, (tx) => mergeLeads(tx, ctx, z.string().uuid().parse(survivorId), z.string().uuid().parse(mergedId), choicesSchema.parse(choices)));
    revalidatePath(`/leads/${survivorId}`);
    revalidatePath(`/leads/${mergedId}`);
    revalidatePath("/leads");
    return { ok: true as const, data: { mergedRecordId: r.mergedRecordId } };
  } catch (e: any) {
    if (e instanceof LeadError || e instanceof ForbiddenError) return { ok: false as const, error: e.message };
    console.error(e);
    return { ok: false as const, error: "Merge failed. Nothing was changed." };
  }
}
