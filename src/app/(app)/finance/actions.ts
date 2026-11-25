"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, ctxFor, authorize, ForbiddenError } from "@/server/auth";
import { FINANCE_FIELDS, mapFinanceRow, type FinanceField, type FinanceRow } from "@/lib/finance";
import { importContracts } from "@/server/finance";

type R = { ok: true; message: string; data: { created: number; updated: number; skipped: number; linked: number; errors: string[] } } | { ok: false; error: string };

const fields = Object.keys(FINANCE_FIELDS) as [FinanceField, ...FinanceField[]];
const schema = z.object({
  filename: z.string().max(200).nullable(),
  mapping: z.record(z.enum(fields), z.string().max(200)),
  rows: z.array(z.record(z.string().max(200), z.string().max(2000))).max(5000),
});

/** Import a Goodshuffle export (Finance: manage). Rows are mapped again here; the browser only previews. */
export async function importFinanceAction(input: z.input<typeof schema>): Promise<R> {
  const session = await requireSession();
  try {
    authorize(session, "finance:manage");
    const v = schema.parse(input);
    if (!v.mapping.project || !v.mapping.total) return { ok: false, error: "Choose the columns for project number and contract total" };
    const rows: FinanceRow[] = [];
    const errors: string[] = [];
    let notContracts = 0;
    v.rows.forEach((raw, i) => {
      const r = mapFinanceRow(raw, v.mapping);
      if (r.ok) rows.push(r.row);
      else if (r.notContract) notContracts++;
      else errors.push(`Row ${i + 2}: ${r.error}`);
    });
    if (!rows.length) return { ok: false, error: errors[0] ?? "No rows to import" };
    const out = await importContracts(ctxFor(session), { rows, skipped: errors.length + notContracts, filename: v.filename, mapping: v.mapping });
    revalidatePath("/finance");
    return {
      ok: true,
      message: `Imported ${rows.length} signed contract${rows.length === 1 ? "" : "s"}: ${out.created} new, ${out.updated} updated; ${out.linked} matched to leads${notContracts ? `. Left out ${notContracts} quote/lost project${notContracts === 1 ? "" : "s"}` : ""}${errors.length ? `, ${errors.length} unreadable row(s)` : ""}`,
      data: { ...out, errors: errors.slice(0, 20) },
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: "That file couldn't be read (too large or unexpected format)" };
    console.error(e);
    return { ok: false, error: "Couldn't import" };
  }
}
