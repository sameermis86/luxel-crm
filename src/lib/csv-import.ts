import { createHash } from "node:crypto";
import type { EventType, LostReason, Source, Status, Tier } from "@/db/schema";
import { SOURCES } from "@/db/schema";
import { parseBudgetRange, parseDateLoose, parseMoney, splitFullName, strOrNull } from "./normalize";
import { mapEventType, mapServices } from "./wix-mapping";

/** What a CSV column can be mapped to. */
export const IMPORT_FIELDS = {
  ignore: "— Ignore —",
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  partnerName: "Partner name",
  email: "Email",
  phone: "Phone",
  eventType: "Event type",
  eventDate: "Event date",
  venueName: "Venue",
  venueCity: "Venue city",
  guestCount: "Guests",
  budget: "Budget (range or amount)",
  budgetMin: "Budget min",
  budgetMax: "Budget max",
  tier: "Tier",
  services: "Services",
  message: "Message / notes",
  source: "Source",
  sourceDetail: "Source detail",
  submittedAt: "Submitted / lead date",
  stage: "Stage / status",
  quoteValue: "Quote value",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type Mapping = Record<string, ImportField>;

const H: [RegExp, ImportField][] = [
  [/^(full ?name|name|client|client name|contact|customer|couple)$/, "fullName"],
  [/^(first ?name|first|given name)$/, "firstName"],
  [/^(last ?name|last|surname|family name)$/, "lastName"],
  [/(partner|fianc|spouse)/, "partnerName"],
  [/e-?mail/, "email"],
  [/(phone|mobile|cell|tel)/, "phone"],
  [/^(event ?type|type|occasion|event category)$/, "eventType"],
  [/(event ?date|wedding ?date|date of event)/, "eventDate"],
  [/(venue ?city|city)/, "venueCity"],
  [/(venue|location)/, "venueName"],
  [/(guest|headcount|attendees)/, "guestCount"],
  [/^(budget|approx.* budget|budget range)/, "budget"],
  [/budget.?min/, "budgetMin"],
  [/budget.?max/, "budgetMax"],
  [/(tier|package)/, "tier"],
  [/service/, "services"],
  [/(message|notes?|comments?|details)/, "message"],
  [/^(source|lead source|how did you hear.*|channel)$/, "source"],
  [/(source detail|referred by|referrer name)/, "sourceDetail"],
  [/(submitted|submission (time|date)|lead.?date|created|date received|inquiry date|date)$/, "submittedAt"],
  [/^(stage|status|pipeline stage)$/, "stage"],
  [/(quote|estimate).*(value|amount|total)?$/, "quoteValue"],
];

/** Guess a mapping from header names. Each field is used at most once (first column wins). */
export function autoMap(headers: string[]): Mapping {
  const used = new Set<ImportField>();
  const out: Mapping = {};
  for (const h of headers) {
    const k = h.trim().toLowerCase().replace(/[_\s]+/g, " ");
    const hit = H.find(([re, f]) => re.test(k) && !used.has(f));
    out[h] = hit ? hit[1] : "ignore";
    if (hit) used.add(hit[1]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

export interface StageMapping {
  status: Status;
  /** for lost leads: the furthest stage they got to before being lost */
  reached?: Status;
  lostReason?: LostReason;
  lostDetail?: string;
}

export interface Preset {
  id: string;
  label: string;
  mapping: Mapping;
  stages: Record<string, StageMapping>;
  defaultSource?: Source;
}

const norm = (s: string) => s.toLowerCase().replace(/[–—-]/g, "-").replace(/\s+/g, " ").trim();

/** Sameer's interim tracker (Claude dashboard export). */
export const INTERIM_TRACKER: Preset = {
  id: "interim_tracker",
  label: "Interim lead tracker (Claude dashboard)",
  mapping: {
    client: "fullName",
    lead_date: "submittedAt",
    event_date: "eventDate",
    event_type: "eventType",
    source: "source",
    stage: "stage",
    tier: "tier",
    quote_value: "quoteValue",
    contract_value: "ignore", // revenue is tracked in the proposals tool
    collected: "ignore",
    notes: "message",
  },
  stages: {
    [norm("New lead")]: { status: "new" },
    [norm("Consult")]: { status: "consult_held" },
    [norm("Quote sent")]: { status: "proposal_sent" },
    [norm("Booked")]: { status: "won" },
    [norm("Lost – no consult")]: { status: "lost", reached: "contacted", lostReason: "no_response", lostDetail: "Lost before a consult" },
    [norm("Lost – after consult")]: { status: "lost", reached: "consult_held", lostReason: "other", lostDetail: "Lost after the consult" },
    [norm("Lost – after quote")]: { status: "lost", reached: "proposal_sent", lostReason: "other", lostDetail: "Lost after the quote" },
  },
};

export const PRESETS: Record<string, Preset> = { [INTERIM_TRACKER.id]: INTERIM_TRACKER };

/** Generic stage words → status (used when no preset or the preset doesn't know the value). */
export function mapStage(v: string | null, preset?: Preset): StageMapping | null {
  if (!v) return null;
  const n = norm(v);
  if (preset?.stages[n]) return preset.stages[n];
  if (/^(won|booked|signed|contracted)/.test(n)) return { status: "won" };
  if (/^lost/.test(n)) return { status: "lost", lostReason: /price|budget/.test(n) ? "price" : /date/.test(n) ? "date_unavailable" : /competitor/.test(n) ? "went_with_competitor" : /no response|ghost/.test(n) ? "no_response" : "other", lostDetail: v };
  if (/(quote|proposal)/.test(n)) return { status: "proposal_sent" };
  if (/consult.*(sched|booked)/.test(n)) return { status: "consult_scheduled" };
  if (/consult/.test(n)) return { status: "consult_held" };
  if (/contact/.test(n)) return { status: "contacted" };
  if (/unqual/.test(n)) return { status: "unqualified" };
  if (/hold/.test(n)) return { status: "on_hold" };
  if (/new/.test(n)) return { status: "new" };
  return null;
}

const SOURCE_WORDS: [RegExp, Source][] = [
  [/quote ?builder|estimat/, "quote_builder"],
  [/contact|website|web form|site form/, "contact_us_form"],
  [/insta|ig\b/, "instagram"],
  [/facebook|\bfb\b|meta/, "facebook"],
  [/google ?ads|adwords|ppc|cpc/, "google_ads"],
  [/google business|gbp|gmb|maps/, "google_business_profile"],
  [/google|seo|search|organic/, "organic_search"],
  [/venue/, "venue_partner"],
  [/referr|word of mouth|friend|past client/, "referral"],
  [/show|expo|fair/, "wedding_show"],
  [/phone|call/, "phone"],
  [/e-?mail/, "email"],
  [/walk/, "walk_in"],
];
export function mapSource(v: string | null): Source | null {
  if (!v) return null;
  const n = v.toLowerCase().trim();
  if ((SOURCES as readonly string[]).includes(n.replace(/\s+/g, "_"))) return n.replace(/\s+/g, "_") as Source;
  return SOURCE_WORDS.find(([re]) => re.test(n))?.[1] ?? "other";
}

const TIERS: Tier[] = ["effortless", "elegant", "elevated", "custom"];

/* -------------------------------------------------------------------------- */
/* Row → lead                                                                 */
/* -------------------------------------------------------------------------- */

export interface ParsedRow {
  rowNumber: number; // 1-based, excluding header (matches spreadsheet row - 1)
  input: Record<string, unknown>;
  explicitSource: Source | null;
  stage: StageMapping | null;
  createdAt: Date | null;
  rowHash: string;
  errors: string[];
  raw: Record<string, string>;
}

/** Fingerprint of the row's mapped values (stable across header order). Used to make re-imports no-ops. */
export function rowHash(raw: Record<string, string>, mapping: Mapping): string {
  const pairs = Object.entries(raw)
    .filter(([h]) => mapping[h] && mapping[h] !== "ignore")
    .map(([h, v]) => [mapping[h], (v ?? "").trim().toLowerCase()])
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex").slice(0, 40);
}

export function parseRow(raw: Record<string, string>, rowNumber: number, mapping: Mapping, opts: { preset?: Preset; defaultSource?: Source | null } = {}): ParsedRow {
  const got: Partial<Record<ImportField, string>> = {};
  for (const [h, v] of Object.entries(raw)) {
    const f = mapping[h];
    const s = strOrNull(v);
    if (!f || f === "ignore" || s === null) continue;
    got[f] = got[f] && f === "message" ? `${got[f]}\n${s}` : got[f] ?? s;
  }
  const errors: string[] = [];
  const input: Record<string, unknown> = {};

  if (got.firstName || got.lastName) {
    input.firstName = got.firstName ?? null;
    input.lastName = got.lastName ?? null;
  } else if (got.fullName) {
    const n = splitFullName(got.fullName);
    input.firstName = n.firstName;
    input.lastName = n.lastName;
    if (n.partnerName) input.partnerName = n.partnerName;
  }
  if (got.partnerName) input.partnerName = got.partnerName;
  if (got.email) input.email = got.email;
  if (got.phone) input.phone = got.phone;
  if (got.eventType) input.eventType = mapEventType(got.eventType) ?? "other";
  if (got.eventDate) {
    const d = parseDateLoose(got.eventDate);
    if (d) input.eventDate = d;
    else errors.push(`Unreadable event date "${got.eventDate}"`);
  }
  if (got.venueName) input.venueName = got.venueName;
  if (got.venueCity) input.venueCity = got.venueCity;
  if (got.guestCount) {
    const n = parseMoney(got.guestCount);
    if (n != null) input.guestCount = Math.round(n);
  }
  if (got.budget) {
    const b = parseBudgetRange(got.budget);
    input.budgetMin = b.min;
    input.budgetMax = b.max;
  }
  if (got.budgetMin) input.budgetMin = parseMoney(got.budgetMin);
  if (got.budgetMax) input.budgetMax = parseMoney(got.budgetMax);
  if (got.tier) input.tierInterest = TIERS.find((t) => got.tier!.toLowerCase().includes(t)) ?? null;
  if (got.services) input.servicesRequested = mapServices(got.services);
  if (got.message) input.message = got.message;
  if (got.sourceDetail) input.sourceDetail = got.sourceDetail;
  for (const [f, k] of [["quoteValue", "quoteValue"]] as const) {
    if (got[f]) {
      const n = parseMoney(got[f]!);
      if (n == null) errors.push(`Unreadable ${IMPORT_FIELDS[f].toLowerCase()} "${got[f]}"`);
      else input[k] = n;
    }
  }

  let createdAt: Date | null = null;
  if (got.submittedAt) {
    const iso = parseDateLoose(got.submittedAt);
    const t = iso ? new Date(`${iso}T12:00:00-05:00`) : Number.isNaN(Date.parse(got.submittedAt)) ? null : new Date(got.submittedAt);
    if (t) createdAt = t;
    else errors.push(`Unreadable submitted/lead date "${got.submittedAt}"`);
  }
  if (createdAt && createdAt.getTime() > Date.now() + 86_400_000) errors.push("Lead date is in the future");

  const stage = mapStage(got.stage ?? null, opts.preset);
  if (got.stage && !stage) errors.push(`Unknown stage "${got.stage}"`);

  if (!input.firstName && !input.lastName && !input.email && !input.phone) errors.push("No name, email or phone");

  return {
    rowNumber,
    input,
    explicitSource: mapSource(got.source ?? null) ?? opts.defaultSource ?? null,
    stage,
    createdAt,
    rowHash: rowHash(raw, mapping),
    errors,
    raw,
  };
}

export const LEAD_IMPORT_STATUSES = (s: StageMapping | null): { create: Status; then?: StageMapping } => {
  if (!s) return { create: "new" };
  if (s.status === "lost") return { create: s.reached ?? "new", then: s };
  return { create: s.status };
};

export type { EventType };
