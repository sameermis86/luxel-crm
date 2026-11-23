/**
 * Duplicate matching rules (pure). The database does a cheap candidate search
 * (same email/phone, same last name, similar name via pg_trgm), then
 * `classifyMatch` decides confidence + reasons, so the rules live in one place.
 */

export interface DupLead {
  id: string;
  emailNormalized: string | null;
  phoneE164: string | null;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  eventDate: string | null;
}

export type MatchReason =
  | "same_email"
  | "same_phone"
  | "same_last_name_and_date"
  | "partner_name_and_date"
  | "similar_name_and_month";

export interface MatchResult {
  confidence: "high" | "medium";
  reasons: MatchReason[];
  similarity: number | null;
}

export const FUZZY_NAME_THRESHOLD = 0.8;

/** Same algorithm as Postgres pg_trgm `similarity()`. */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const lastToken = (s: string | null | undefined) => norm(s).split(/\s+/).filter(Boolean).pop() ?? "";
export const fullName = (l: Pick<DupLead, "firstName" | "lastName">) => norm(`${l.firstName ?? ""} ${l.lastName ?? ""}`);

export function classifyMatch(a: DupLead, b: DupLead): MatchResult | null {
  if (a.id === b.id) return null;
  const reasons: MatchReason[] = [];

  if (a.emailNormalized && a.emailNormalized === b.emailNormalized) reasons.push("same_email");
  if (a.phoneE164 && a.phoneE164 === b.phoneE164) reasons.push("same_phone");
  if (reasons.length) return { confidence: "high", reasons, similarity: null };

  const sameDate = !!a.eventDate && a.eventDate === b.eventDate;
  const sameMonth = !!a.eventDate && !!b.eventDate && a.eventDate.slice(0, 7) === b.eventDate.slice(0, 7);

  if (sameDate && norm(a.lastName) && norm(a.lastName) === norm(b.lastName)) reasons.push("same_last_name_and_date");
  if (sameDate) {
    const aNames = [lastToken(a.lastName), lastToken(a.partnerName)].filter(Boolean);
    const bNames = [lastToken(b.lastName), lastToken(b.partnerName)].filter(Boolean);
    const crossPartner =
      (!!a.partnerName && bNames.includes(lastToken(a.partnerName))) ||
      (!!b.partnerName && aNames.includes(lastToken(b.partnerName)));
    if (crossPartner) reasons.push("partner_name_and_date");
  }

  let similarity: number | null = null;
  const an = fullName(a);
  const bn = fullName(b);
  if (sameMonth && an && bn) {
    similarity = trigramSimilarity(an, bn);
    if (similarity >= FUZZY_NAME_THRESHOLD - 1e-9) reasons.push("similar_name_and_month");
  }

  return reasons.length ? { confidence: "medium", reasons, similarity } : null;
}

export const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  same_email: "Same email",
  same_phone: "Same phone",
  same_last_name_and_date: "Same last name and event date",
  partner_name_and_date: "Partner name and event date",
  similar_name_and_month: "Similar name and event month",
};
