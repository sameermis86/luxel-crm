/** Goodshuffle contract export → finance rows. Pure: column guessing, money and date parsing. */

export const FINANCE_FIELDS = {
  project: { label: "Project number", required: true, guess: [/^project\s*(#|no\.?|number|id)?$/i, /^(order|quote|booking)\s*(#|no\.?|number|id)$/i, /^id$/i] },
  total: { label: "Contract total", required: true, guess: [/contract\s*(total|value|amount)/i, /^(grand\s*)?total(\s*\(.*\))?$/i, /^(project|order)\s*total$/i, /^amount$/i] },
  paid: { label: "Paid", required: false, guess: [/^(amount\s*)?paid$/i, /^payments?(\s*received)?$/i, /total\s*paid/i] },
  balance: { label: "Balance due (amount due)", required: false, guess: [/balance(\s*due)?/i, /amount\s*due/i, /outstanding/i] },
  client: { label: "Client", required: false, guess: [/^client(\s*name)?$/i, /^customer(\s*name)?$/i, /^contact$/i] },
  name: { label: "Project name", required: false, guess: [/^(project|event)\s*name$/i, /^name$/i, /^title$/i] },
  eventDate: { label: "Event date", required: false, guess: [/^event\s*(start\s*)?date$/i, /^(start|delivery|event)\s*(date)?$/i, /^date$/i] },
  status: { label: "Status", required: false, guess: [/^status$/i, /^stage$/i] },
} as const;
export type FinanceField = keyof typeof FINANCE_FIELDS;
export type FinanceMapping = Partial<Record<FinanceField, string>>; // field -> CSV header

export function guessMapping(headers: string[]): FinanceMapping {
  const out: FinanceMapping = {};
  const used = new Set<string>();
  for (const [field, def] of Object.entries(FINANCE_FIELDS) as [FinanceField, (typeof FINANCE_FIELDS)[FinanceField]][]) {
    for (const re of def.guess) {
      const h = headers.find((x) => !used.has(x) && re.test(x.trim()));
      if (h) { out[field] = h; used.add(h); break; }
    }
  }
  return out;
}

/** "$12,345.67", "CA$ 1,200", "(250.00)" (negative), "1 234,50"? (not supported: Goodshuffle exports en-CA). */
export function parseMoney(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "-" || s === "—") return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d\-(]/g, ""));
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits || !/\d/.test(digits) || (digits.match(/\./g) ?? []).length > 1) return null;
  const n = Math.round(Number(digits) * 100) / 100;
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) =>
  y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

/** 2027-06-12, 6/12/2027 (month first, North American), Jun 12 2027, 12 June 2027, with or without a time. */
export function parseDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = s.match(/^(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

export interface FinanceRow { project: string; total: number; paid: number | null; balance: number | null; client: string | null; name: string | null; eventDate: string | null; status: string | null }

/** Goodshuffle statuses that aren't signed contracts. ("Contract Signed" and "Unsigned Changes" are.) */
const NOT_CONTRACT = /^(lost|quote sent|new project|cancel+ed|declined|expired|draft)$/i;

export function mapFinanceRow(raw: Record<string, string>, mapping: FinanceMapping): { ok: true; row: FinanceRow } | { ok: false; error: string; notContract?: boolean } {
  const get = (f: FinanceField) => (mapping[f] ? (raw[mapping[f]!] ?? "").trim() : "");
  const project = get("project").replace(/^#/, "").trim();
  if (!project) return { ok: false, error: "No project number" };
  const status = get("status") || null;
  // only signed contracts belong in Finance: Goodshuffle's project list also has quotes and lost projects
  if (status && NOT_CONTRACT.test(status)) return { ok: false, error: `Project ${project}: ${status} (not a signed contract)`, notContract: true };
  const total = parseMoney(get("total"));
  if (total == null || total <= 0) return { ok: false, error: `Project ${project}: no contract total (not signed)`, notContract: true };
  const round = (n: number) => Math.round(n * 100) / 100;
  const paidIn = parseMoney(get("paid"));
  const balanceIn = parseMoney(get("balance"));
  // Goodshuffle's project list has "Amount Due" but no "Paid": paid = total - amount due
  const paid = paidIn ?? (balanceIn != null ? round(total - balanceIn) : null);
  const balance = balanceIn ?? (paidIn != null ? round(total - paidIn) : null);
  return {
    ok: true,
    row: { project, total, paid, balance, client: get("client") || null, name: get("name") || null, eventDate: parseDate(get("eventDate")), status },
  };
}
