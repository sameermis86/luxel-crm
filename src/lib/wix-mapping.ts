import { createHash } from "node:crypto";
import type { EventType, Tier } from "@/db/schema";
import { parseBudgetRange, parseDateLoose, parseMoney, splitFullName, strOrNull } from "./normalize";
import type { IntakeForm } from "./source";

/**
 * Turns anything Wix sends into intake fields. Accepts three shapes:
 *
 * 1. The canonical payload our Velo snippet sends (see docs/wix-integration.md):
 *    { form, submission_id, first_name, last_name, email, phone, event_date, ... }
 * 2. A Wix Automations "Send HTTP request" body — flat keys or nested under `data`,
 *    with either our keys ("Choose fields") or Wix's own labels/targets ("All automation data").
 * 3. A Wix Forms submission object from the REST API (backfill):
 *    { id, formId, createdDate, submissions: { email_b935: "...", event_date: "..." } }
 *
 * Field matching is by meaning (key/label words), so the random suffixes Wix adds
 * to field targets (`email_b935`) and future form edits don't break intake.
 */

export interface MappedSubmission {
  form: IntakeForm;
  submissionId: string;
  submittedAt: Date | null;
  input: {
    fullName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    partnerName?: string | null;
    email?: string | null;
    phone?: string | null;
    eventType?: EventType;
    eventDate?: string | null;
    venueName?: string | null;
    venueCity?: string | null;
    guestCount?: number | null;
    budgetMin?: number | null;
    budgetMax?: number | null;
    estimateTotal?: number | null;
    tierInterest?: Tier | null;
    servicesRequested?: string[];
    message?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    landingPage?: string | null;
    referrerUrl?: string | null;
    sourceDetail?: string | null;
  };
  /** keys we couldn't place, kept so nothing a client wrote is lost */
  unmapped: Record<string, string>;
}

type Flat = Record<string, unknown>;

const keyOf = (k: string) =>
  k
    .toLowerCase()
    .replace(/_[0-9a-f]{3,5}$/i, "") // Wix target suffix: email_b935
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function flatten(obj: unknown, out: Flat = {}, prefix = ""): Flat {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) flatten(v, out, prefix ? `${prefix}.${k}` : k);
      else out[prefix ? `${prefix}.${k}` : k] = v;
    }
  }
  return out;
}

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ") || null;
  return strOrNull(v);
};

/** Ordered rules: first rule whose pattern matches a key claims it. */
const RULES: { field: string; re: RegExp }[] = [
  { field: "submissionId", re: /^(submission id|submissionid|submission)$/ },
  { field: "form", re: /^(form|form type|form name|formname)$/ },
  { field: "submittedAt", re: /^(submitted at|submitted|submission time|created date|createddate|created at|timestamp)$/ },
  { field: "utmSource", re: /^utm source$/ },
  { field: "utmMedium", re: /^utm medium$/ },
  { field: "utmContent", re: /^utm content$/ },
  { field: "utmTerm", re: /^utm term$/ },
  { field: "landingPage", re: /^(landing page|landing url|page url|page)$/ },
  { field: "referrerUrl", re: /^(referrer|referrer url|referer|document referrer)$/ },
  { field: "partnerName", re: /(partner|fianc|spouse)/ },
  { field: "firstName", re: /^(first name|firstname|first)$/ },
  { field: "lastName", re: /^(last name|lastname|last|surname)$/ },
  { field: "fullName", re: /^(full name|name|your name|fullname|contact name)$/ },
  { field: "email", re: /(^| )e ?mail( |$)|enter your email/ },
  { field: "phone", re: /(phone|mobile|cell|tel)/ },
  { field: "eventDate", re: /(event date|wedding date|date of (the )?event|^date$)/ },
  { field: "guestCount", re: /(guest|number of people|headcount|attendees)/ },
  { field: "estimateTotal", re: /(estimate|estimated total|quote total|total)/ },
  { field: "budget", re: /budget/ },
  { field: "tierInterest", re: /(tier|package|collection)/ },
  { field: "venueCity", re: /(venue city|city|town|location city)/ },
  { field: "venueName", re: /(venue|location|reception)/ },
  { field: "eventType", re: /(occasion|event type|type of event|what s the occasion)/ },
  { field: "services", re: /(service|looking for|interested in)/ },
  { field: "message", re: /(message|tell us|anything else|notes|details|theme|colou?rs|pinterest|comments)/ },
  { field: "sourceDetail", re: /(how did you hear|heard about|referred by|referral)/ },
];

const TIER_WORDS: Record<string, Tier> = { effortless: "effortless", elegant: "elegant", elevated: "elevated", custom: "custom" };

export function mapEventType(v: string | null): EventType | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (/wedding|engagement|bridal|nikah|sangeet|mehndi|reception/.test(s)) return "wedding";
  if (/corporate|gala|fundraiser|prom|conference|company|business/.test(s)) return "corporate";
  if (/rental/.test(s) && !/decor|floral/.test(s)) return "rental_only";
  if (/social|birthday|shower|anniversary|baptism|communion|party|sweet|quince|bar mitzvah|bat mitzvah/.test(s)) return "social";
  return "other";
}

export function mapServices(v: string | null): string[] {
  if (!v) return [];
  const s = v.toLowerCase();
  const out = new Set<string>();
  if (/full decor and floral|event design, decor and florals/.test(s)) ["florals", "centerpieces", "backdrop", "draping"].forEach((x) => out.add(x));
  if (/floral|flower|bouquet/.test(s)) out.add("florals");
  if (/centerpiece|centrepiece/.test(s)) out.add("centerpieces");
  if (/ceremony|mandap|arch/.test(s)) out.add("ceremony");
  if (/backdrop|stage/.test(s)) out.add("backdrop");
  if (/drap/.test(s)) out.add("draping");
  if (/light/.test(s)) out.add("lighting");
  if (/rental/.test(s)) out.add("rentals");
  if (/\bdecor\b/.test(s) && !out.size) out.add("decor");
  return [...out];
}

/** Stable id for payloads that don't carry one (Automations), so retries stay idempotent. */
export function fingerprint(form: string, parts: unknown[]): string {
  return "fp_" + createHash("sha256").update(JSON.stringify([form, ...parts])).digest("hex").slice(0, 32);
}

export function mapWixPayload(body: unknown, opts: { defaultForm?: IntakeForm } = {}): MappedSubmission {
  const root = (body ?? {}) as Record<string, any>;
  // unwrap the common envelopes
  const inner: Record<string, any> =
    root.submission && typeof root.submission === "object" ? { ...root, ...root.submission } :
    root.data && typeof root.data === "object" && !Array.isArray(root.data) ? { ...root, ...root.data } : root;
  const answers = inner.submissions && typeof inner.submissions === "object" ? inner.submissions : {};
  const flat = flatten({ ...inner, submissions: undefined, data: undefined, submission: undefined, ...answers });

  const got: Record<string, string> = {};
  const unmapped: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(flat)) {
    const text = asText(rawVal);
    if (text === null) continue;
    const leaf = rawKey.split(".").pop()!;
    const k = keyOf(leaf);
    if (["id", "formid", "namespace", "status", "seen", "revision", "contactid", "updateddate", "secret", "token", "signature"].includes(k.replace(/ /g, ""))) {
      if (k === "id" && !got.submissionId && (inner.formId || inner.submissions)) got.submissionId = text;
      continue;
    }
    if (rawKey.startsWith("submitter.")) continue;
    const rule = RULES.find((r) => r.re.test(k));
    if (!rule) {
      unmapped[leaf] = text;
      continue;
    }
    if (got[rule.field]) got[rule.field] += rule.field === "message" ? `\n${text}` : "";
    else got[rule.field] = text;
  }

  const formRaw = (got.form ?? "").toLowerCase();
  const form: IntakeForm =
    /quote|estimat/.test(formRaw) ? "quote_builder" : /contact|inquir|event/.test(formRaw) ? "contact_us" : opts.defaultForm ?? (got.estimateTotal || got.tierInterest ? "quote_builder" : "contact_us");

  const input: MappedSubmission["input"] = {};
  if (got.firstName || got.lastName) {
    input.firstName = got.firstName ?? null;
    input.lastName = got.lastName ?? null;
    // "Full Name" typed into a first-name field (Wix's Event Contact Form does this)
    if (input.firstName && !input.lastName && input.firstName.includes(" ")) {
      const s = splitFullName(input.firstName);
      input.firstName = s.firstName;
      input.lastName = s.lastName;
      if (s.partnerName) input.partnerName = s.partnerName;
    }
  } else if (got.fullName) input.fullName = got.fullName;
  if (got.partnerName) input.partnerName = got.partnerName;
  if (got.email) input.email = got.email;
  if (got.phone) input.phone = got.phone;
  if (got.eventDate) input.eventDate = parseDateLoose(got.eventDate);
  if (got.guestCount) {
    const n = parseMoney(got.guestCount);
    input.guestCount = n != null ? Math.round(n) : null;
  }
  if (got.budget) {
    const b = parseBudgetRange(got.budget);
    input.budgetMin = b.min;
    input.budgetMax = b.max;
  }
  if (got.estimateTotal) input.estimateTotal = parseMoney(got.estimateTotal);
  if (got.tierInterest) input.tierInterest = TIER_WORDS[Object.keys(TIER_WORDS).find((t) => got.tierInterest!.toLowerCase().includes(t)) ?? ""] ?? null;
  if (got.venueName) input.venueName = got.venueName;
  if (got.venueCity) input.venueCity = got.venueCity;
  const et = mapEventType(got.eventType ?? null);
  if (et) input.eventType = et;
  if (got.services) input.servicesRequested = mapServices(got.services);
  if (input.eventType === undefined && input.servicesRequested?.length === 1 && input.servicesRequested[0] === "rentals") input.eventType = "rental_only";
  const msg = [got.message, got.services && !input.servicesRequested?.length ? `Services: ${got.services}` : null].filter(Boolean).join("\n");
  if (msg) input.message = msg;
  for (const k of ["utmSource", "utmMedium", "utmContent", "utmTerm", "landingPage", "referrerUrl", "sourceDetail"] as const) {
    if (got[k]) input[k] = got[k];
  }

  const submittedAt = got.submittedAt && !Number.isNaN(Date.parse(got.submittedAt)) ? new Date(got.submittedAt) : null;
  const submissionId = got.submissionId ?? fingerprint(form, [input.email, input.phone, input.firstName ?? input.fullName, input.eventDate, input.message, got.submittedAt]);

  return { form, submissionId, submittedAt, input, unmapped };
}
