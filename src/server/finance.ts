import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { withCtx, type Ctx, type Tx } from "@/db/client";
import { financeContracts, financeImports, leads, waveInvoices } from "@/db/schema";
import { INVOICED_STATUSES } from "@/lib/wave";
import type { FinanceMapping, FinanceRow } from "@/lib/finance";
import { audit } from "./audit";

/**
 * Finance: contracts from a Goodshuffle export (upsert by project number), linked to the lead with that
 * Goodshuffle project. Accounting itself lives in Wave; linking contracts to Wave comes later.
 */
export async function importContracts(
  ctx: Ctx,
  input: { rows: FinanceRow[]; skipped: number; filename: string | null; mapping: FinanceMapping; replace?: boolean },
  now = new Date(),
) {
  return withCtx(ctx, async (tx) => {
    // "replace": this file becomes the whole set (same transaction, so a failed import changes nothing)
    let replaced = 0;
    if (input.replace) replaced = (await tx.delete(financeContracts).returning({ id: financeContracts.id })).length;
    const projects = [...new Set(input.rows.map((r) => r.project))];
    const existing = projects.length ? await tx.select({ project: financeContracts.project }).from(financeContracts).where(inArray(financeContracts.project, projects)) : [];
    const had = new Set(existing.map((e) => e.project));
    const leadRows = projects.length
      ? await tx.select({ id: leads.id, project: leads.goodshuffleProject }).from(leads).where(and(inArray(leads.goodshuffleProject, projects), sql`${leads.duplicateOfId} is null`))
      : [];
    const leadBy = new Map(leadRows.map((l) => [l.project!, l.id]));
    const [imp] = await tx
      .insert(financeImports)
      .values({ orgId: ctx.orgId, filename: input.filename, rows: input.rows.length + input.skipped, skipped: input.skipped, mapping: input.mapping, importedBy: ctx.userId, createdAt: now })
      .returning({ id: financeImports.id });
    let created = 0, updated = 0;
    // last row wins if a project appears twice in the file
    const byProject = new Map(input.rows.map((r) => [r.project, r]));
    for (const r of byProject.values()) {
      const vals = { name: r.name, client: r.client, eventDate: r.eventDate, status: r.status, total: r.total, paid: r.paid, balance: r.balance, leadId: leadBy.get(r.project) ?? null, importId: imp.id, raw: r, updatedAt: now };
      await tx
        .insert(financeContracts)
        .values({ orgId: ctx.orgId, project: r.project, ...vals })
        .onConflictDoUpdate({ target: [financeContracts.orgId, financeContracts.project], set: vals });
      if (had.has(r.project)) updated++;
      else created++;
    }
    await tx.update(financeImports).set({ created, updated }).where(eq(financeImports.id, imp.id));
    await audit(tx, ctx, "finance.imported", null, { filename: input.filename, created, updated, skipped: input.skipped, ...(input.replace ? { replacedPrevious: replaced } : {}) });
    return { created, updated, skipped: input.skipped, linked: [...byProject.keys()].filter((p) => leadBy.has(p)).length, replaced };
  });
}

const sum = (col: unknown) => sql<number>`coalesce(sum(${col}), 0)::float`;

/** Years that have contracts (by event date), ascending. */
export async function financeYears(tx: Tx): Promise<number[]> {
  const rows = await tx
    .select({ y: sql<number>`extract(year from ${financeContracts.eventDate})::int` })
    .from(financeContracts)
    .where(isNotNull(financeContracts.eventDate))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => r.y);
}

/** Revenue for contracts whose event falls in [from, to), plus everything still ahead of today. */
export async function financeOverview(tx: Tx, from: string, to: string, today: string) {
  const inRange = and(isNotNull(financeContracts.eventDate), gte(financeContracts.eventDate, from), lt(financeContracts.eventDate, to));
  const [k] = await tx.select({ contracts: sql<number>`count(*)::int`, total: sum(financeContracts.total) }).from(financeContracts).where(inRange);
  const [ahead] = await tx
    .select({ contracts: sql<number>`count(*)::int`, total: sum(financeContracts.total) })
    .from(financeContracts)
    .where(gte(financeContracts.eventDate, today));
  const byMonth = await tx
    .select({ month: sql<string>`to_char(${financeContracts.eventDate}, 'YYYY-MM')`, contracts: sql<number>`count(*)::int`, total: sum(financeContracts.total) })
    .from(financeContracts)
    .where(inRange)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const bySource = await tx
    .select({ source: sql<string>`coalesce(${leads.source}::text, 'unlinked')`, contracts: sql<number>`count(*)::int`, total: sum(financeContracts.total) })
    .from(financeContracts)
    .leftJoin(leads, eq(leads.id, financeContracts.leadId))
    .where(inRange)
    .groupBy(sql`1`)
    .orderBy(sql`3 desc`);
  const list = await tx
    .select({ c: financeContracts, recordId: leads.recordId })
    .from(financeContracts)
    .leftJoin(leads, eq(leads.id, financeContracts.leadId))
    .where(inRange)
    .orderBy(asc(financeContracts.eventDate))
    .limit(500);
  const [{ undated }] = await tx.select({ undated: sql<number>`count(*)::int` }).from(financeContracts).where(sql`${financeContracts.eventDate} is null`);
  const [last] = await tx.select().from(financeImports).orderBy(sql`${financeImports.createdAt} desc`).limit(1);

  // Wave: invoiced per contract (drafts aren't invoiced), the year's invoiced total by invoice date,
  // and invoices we couldn't match to a contract
  const invoiced = sql`${waveInvoices.status} in (${sql.join(INVOICED_STATUSES.map((x) => sql`${x}`), sql`, `)})`;
  const perContract = await tx
    .select({ contractId: waveInvoices.contractId, total: sum(waveInvoices.total), count: sql<number>`count(*)::int` })
    .from(waveInvoices)
    .where(and(invoiced, isNotNull(waveInvoices.contractId)))
    .groupBy(waveInvoices.contractId);
  const [inv] = await tx
    .select({ total: sum(waveInvoices.total), count: sql<number>`count(*)::int` })
    .from(waveInvoices)
    .where(and(invoiced, gte(waveInvoices.invoiceDate, from), lt(waveInvoices.invoiceDate, to)));
  const unmatched = await tx
    .select({ id: waveInvoices.id, invoiceNumber: waveInvoices.invoiceNumber, customerName: waveInvoices.customerName, invoiceDate: waveInvoices.invoiceDate, total: waveInvoices.total, project: waveInvoices.project, viewUrl: waveInvoices.viewUrl })
    .from(waveInvoices)
    .where(and(invoiced, sql`${waveInvoices.contractId} is null`, gte(waveInvoices.invoiceDate, from), lt(waveInvoices.invoiceDate, to)))
    .orderBy(asc(waveInvoices.invoiceDate))
    .limit(100);
  const invoicedBy = new Map(perContract.map((p) => [p.contractId!, p]));
  return { kpis: k, ahead, byMonth, bySource, list, undated, lastImport: last ?? null, wave: { invoicedBy, year: inv, unmatched } };
}
