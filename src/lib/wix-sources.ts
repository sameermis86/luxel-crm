/**
 * Turns the two Wix lead sources on luxeldecor.com into intake payloads that
 * mapWixPayload() understands, and decides which records to import:
 *
 *  - Wix Forms submissions (Event Contact Form, Meet with Us, Contact, ...)
 *  - the Quote Builder's CMS collection `QuoteLeads` (custom Velo code)
 *
 * Shared by the scheduled sync and the one-off backfill script so both behave the same.
 */

export interface WixFormSubmission {
  id: string;
  formId: string;
  createdDate: string;
  submissions?: Record<string, unknown>;
}

export interface QuoteLeadItem {
  _id: string;
  _createdDate?: { $date: string } | string;
  submittedAt?: string;
  name?: string;
  email?: string;
  phone?: string;
  eventType?: string;
  eventDate?: string;
  venue?: string;
  guests?: string | number;
  tier?: string;
  estimateLow?: number;
  estimateHigh?: number;
  vision?: string;
  itemsList?: string;
  status?: string; // "full_submission" | "gate_captured"
}

/** Forms that aren't client inquiries. */
export const NON_LEAD_FORM = /job|career|subscri|newsletter/i;
export const isLeadForm = (formName: string) => !NON_LEAD_FORM.test(formName);

/** Luxel's choice (Nov 2026): Event Contact Form inquiries with no explicit occasion are weddings. */
export const DEFAULT_OCCASION_BY_FORM: Record<string, string> = { "Event Contact Form": "Wedding" };

/** Field keys Wix generates without meaning; use the question label instead. */
const OPAQUE_TARGET = /^(multi_choice|single_choice|dropdown|short_answer|long_answer|form_field|checkbox|number)_[0-9a-f]{3,5}$/;

export function inferOccasion(text: string): string | null {
  const t = text.toLowerCase();
  if (/bridal shower|baby shower|\bshower\b/.test(t)) return "Social Events";
  if (/baptism|christening|communion|birthday|sweet 16|anniversary|graduation/.test(t)) return "Social Events";
  if (/corporate|holiday dinner|fundraiser|\bgala\b|charity|company|conference|\bprom\b/.test(t)) return "Corporate Events";
  if (/wedding|bride|bridal|groom|fianc|ceremony|reception|married|sweetheart|bouquet|boutonni|aisle|altar|chuppah|mandap/.test(t)) return "Wedding";
  return null;
}

const firstDate = (v: unknown): string | null => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Event date of a form submission (first answer whose key looks like a date field). */
export function submissionEventDate(s: WixFormSubmission): string | null {
  const a = s.submissions ?? {};
  const key = Object.keys(a).find((k) => /event_date|date/.test(k));
  return key ? firstDate(a[key]) : null;
}

/**
 * Import rule Luxel asked for: skip leads whose event date has passed.
 * No event date: only if submitted within the last ~6 months (older ones are stale).
 */
export function shouldImport(eventDate: string | null, createdAt: string | null, today: string, now = new Date()): boolean {
  if (eventDate) return eventDate >= today;
  if (!createdAt) return false;
  return new Date(createdAt).getTime() >= now.getTime() - 182 * 86_400_000;
}

export function formSubmissionToPayload(s: WixFormSubmission, formName: string, labels: Record<string, string> = {}) {
  const submissions: Record<string, string> = {};
  for (const [target, raw] of Object.entries(s.submissions ?? {})) {
    if (raw === null || raw === undefined || raw === "") continue;
    const value = typeof raw === "object" ? (Array.isArray(raw) ? raw.join(", ") : JSON.stringify(raw)) : String(raw);
    const label = labels[target];
    let key = OPAQUE_TARGET.test(target) && label ? label : target;
    if (/occasion|type of event|event type/i.test(label ?? "")) key = "occasion";
    submissions[key] = value;
  }
  const allText = Object.values(submissions).join(" ");
  if (!submissions.occasion) {
    const occasion = inferOccasion(allText) ?? DEFAULT_OCCASION_BY_FORM[formName] ?? null;
    if (occasion) submissions.occasion = occasion;
  }
  const tier = allText.match(/\((Effortless|Elegant|Elevated)\)/i)?.[1];
  if (tier && !submissions.tier) submissions.tier = tier;
  return { id: s.id, form: /quote|estimat/i.test(formName) ? "quote_builder" : "contact_us", formName, createdDate: s.createdDate, submissions };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function quoteLeadCreatedAt(q: QuoteLeadItem): string | null {
  const c = typeof q._createdDate === "object" ? q._createdDate?.$date : q._createdDate;
  return q.submittedAt && !Number.isNaN(Date.parse(q.submittedAt)) ? q.submittedAt : c ?? null;
}

/** Quote Builder (QuoteLeads collection) item → intake payload. Submission id is namespaced "ql_". */
export function quoteLeadToPayload(q: QuoteLeadItem) {
  const low = typeof q.estimateLow === "number" ? q.estimateLow : null;
  const high = typeof q.estimateHigh === "number" ? q.estimateHigh : null;
  const estimate = low != null && high != null ? (low + high) / 2 : high ?? low;
  const notes = [
    q.vision?.trim() || null,
    low != null || high != null ? `Quote Builder estimate: ${low != null ? money(low) : "?"}–${high != null ? money(high) : "?"}` : null,
    q.itemsList?.trim() ? `Selected: ${q.itemsList.trim()}` : null,
    q.status === "gate_captured" ? "Left the estimator after the contact step (partial estimate)." : null,
  ].filter(Boolean);
  const occasion = q.eventType || inferOccasion(notes.join(" ")) || "Wedding";
  const payload: Record<string, unknown> = {
    form: "quote_builder",
    submission_id: `ql_${q._id}`,
    submitted_at: quoteLeadCreatedAt(q),
    full_name: q.name,
    email: q.email,
    phone: q.phone,
    occasion,
    event_date: q.eventDate,
    venue: q.venue,
    guests: q.guests != null ? String(q.guests) : undefined,
    tier: q.tier,
    estimate_total: estimate ?? undefined,
    services: q.itemsList,
    message: notes.join("\n") || undefined,
  };
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}
