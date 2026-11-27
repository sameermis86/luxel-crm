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
  total: WaveMoney | null;
  amountDue: WaveMoney | null;
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

/** Wave Money: `raw` is the amount in minor units (cents); `value` is display text, e.g. "1,234.00". */
export interface WaveMoney { raw?: number | null; value?: string | null }
export const num = (m: WaveMoney | null | undefined) => {
  if (!m) return null;
  if (typeof m.raw === "number" && Number.isFinite(m.raw)) return Math.round(m.raw) / 100;
  const n = Number(String(m.value ?? "").replace(/[^0-9.\-]/g, ""));
  return m.value != null && String(m.value).trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
