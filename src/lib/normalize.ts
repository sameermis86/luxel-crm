import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function isValidEmail(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email.trim());
}

/** lower-case, trim, strip +tags everywhere and dots for Gmail. Returns null if invalid. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  const at = e.lastIndexOf("@");
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  local = local.split("+")[0];
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

/** E.164, default region CA. Returns null if not a possible number. */
export function normalizePhone(phone: string | null | undefined, region: "CA" = "CA"): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (trimmed.replace(/\D/g, "").length < 7) return null;
  const parsed = parsePhoneNumberFromString(trimmed, region);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function isValidPhone(phoneE164: string | null | undefined) {
  return !!phoneE164 && /^\+\d{8,15}$/.test(phoneE164);
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string) => (s && s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export interface SplitName {
  firstName: string | null;
  lastName: string | null;
  partnerName?: string;
}

/** "Sofia Rossi", "Rossi, Sofia", "Sofia Rossi & Marco Bianchi", "Maria de la Cruz" */
export function splitFullName(full: string | null | undefined): SplitName {
  if (!full || !clean(full)) return { firstName: null, lastName: null };
  let s = clean(full);
  let partnerName: string | undefined;
  const couple = s.split(/\s+(?:&|and|\+)\s+/i);
  if (couple.length >= 2) {
    s = couple[0];
    partnerName = clean(couple.slice(1).join(" & "));
  }
  let firstName: string | null;
  let lastName: string | null;
  if (s.includes(",")) {
    const [last, first] = s.split(",").map(clean);
    firstName = first || null;
    lastName = last || null;
  } else {
    const parts = s.split(" ");
    firstName = parts[0];
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }
  // "Olivia & Daniel Park": a single first name shares the partner's surname
  if (!lastName && partnerName && partnerName.split(" ").length > 1) lastName = partnerName.split(" ").pop()!;
  const out: SplitName = { firstName: firstName ? cap(firstName) : null, lastName: lastName ? cap(lastName) : null };
  if (partnerName) out.partnerName = partnerName;
  return out;
}

/** "$7,500" → 7500, "7.5k" → 7500. null if no number. */
export function parseMoney(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = v.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|K)?/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
}

/** "$5,000 - $8,000", "Under $3,000", "$10,000+", "6000" */
export function parseBudgetRange(v: string | number | null | undefined): { min: number | null; max: number | null } {
  if (v === null || v === undefined || v === "") return { min: null, max: null };
  if (typeof v === "number") return { min: v, max: v };
  const s = v.replace(/,/g, "");
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(k|K)?/g)].map((m) => parseFloat(m[1]) * (m[2] ? 1000 : 1));
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length >= 2) return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
  if (/under|less than|below|up to|max|</i.test(s)) return { min: null, max: nums[0] };
  if (/\+|over|more than|above|at least|min|>/i.test(s)) return { min: nums[0], max: null };
  return { min: nums[0], max: nums[0] };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Returns an ISO date (YYYY-MM-DD) or null. Slash dates are read as MM/DD/YYYY (North American). */
export function parseDateLoose(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return a > 12 ? ymd(+m[3], b, a) : ymd(+m[3], a, b);
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return null;
}

/** "Woodbridge, ON" → "woodbridge"; "Niagara-on-the-Lake" → "niagara on the lake" */
export function normalizeCity(city: string | null | undefined): string {
  if (!city) return "";
  return city
    .toLowerCase()
    .replace(/,?\s*(ontario|on|canada|ca)\.?\s*$/g, "")
    .replace(/,?\s*(ontario|on)\.?\s*$/g, "")
    .replace(/[.,]/g, " ")
    .replace(/-/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

export const strOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
