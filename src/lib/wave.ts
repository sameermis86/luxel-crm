/** Wave (accounting) invoices: pure helpers for matching and counting. */

export interface WaveInvoiceNode {
  id: string;
  invoiceNumber: string | null;
  status: string;
  title: string | null;
  subhead?: string | null;
  poNumber: string | null;
  memo: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  modifiedAt: string | null;
  viewUrl: string | null;
  customer: { name: string | null } | null;
  currency: { code: string } | null;
  total: { value: string } | null;
  amountDue: { value: string } | null;
}

/** Statuses that are real invoices (drafts aren't revenue yet). */
export const INVOICED_STATUSES = ["SAVED", "SENT", "VIEWED", "UNPAID", "PARTIAL", "PAID", "OVERDUE"];
export const isInvoiced = (status: string) => INVOICED_STATUSES.includes(status.toUpperCase());

/**
 * The Goodshuffle project number on an invoice: looked for in the PO/SO number first, then the title,
 * subheading and memo. Prefers a number we have a contract for; else the first long number found.
 */
export function findProject(inv: Pick<WaveInvoiceNode, "poNumber" | "title" | "subhead" | "memo">, known: Set<string>): string | null {
  const found: string[] = [];
  for (const text of [inv.poNumber, inv.title, inv.subhead, inv.memo]) {
    for (const m of (text ?? "").matchAll(/(?<![\d.])#?(\d{6,10})(?![\d.])/g)) found.push(m[1]);
  }
  return found.find((p) => known.has(p)) ?? found[0] ?? null;
}

export const num = (m: { value: string } | null | undefined) => {
  const n = m ? Number(m.value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
