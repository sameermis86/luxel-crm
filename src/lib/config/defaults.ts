import { z } from "zod";
import { EVENT_TYPES, SOURCES } from "@/db/schema";

/**
 * Every tunable number in the CRM lives here. Owners can override any of these
 * per org in Settings (stored in org_settings.settings, deep-merged over these).
 */


export const businessHoursSchema = z.object({
  timezone: z.string(),
  /** 0 = Sunday … 6 = Saturday */
  days: z.array(z.number().int().min(0).max(6)),
  startHour: z.number().min(0).max(23),
  endHour: z.number().min(1).max(24),
});

export const followUpSchema = z.object({
  firstResponseBusinessHours: z.number(),
  afterContactedDays: z.number(),
  beforeConsultDays: z.number(),
  afterProposalDays: z.number(),
  newLeadNoContactHours: z.number(),
  digestHour: z.number(),
  /** dashboard action queue: an uncontacted inquiry counts as "new" for this many days */
  freshInquiryDays: z.number().int().min(1).default(14),
  /** dashboard action queue: chase a quote with no decision after this many days */
  chaseQuoteDays: z.number().int().min(1).default(7),
});

export const utmRuleSchema = z.object({
  /** lower-case; "*" = any. Matched against utm_source / utm_medium */
  source: z.string(),
  medium: z.string(),
  result: z.enum(SOURCES),
});

export const opsSchema = z.object({
  /** setup steps added for every decor area of an event ("{area}" is replaced) */
  setupSteps: z.array(z.string()).default([]),
  /** teardown steps added for every decor area of an event */
  teardownSteps: z.array(z.string()).default([]),
  /** signed events stay on the Ops board this many days after the event (for teardown and returns) */
  keepDaysAfter: z.number().int().min(0).default(14),
});

export const setmoreSchema = z.object({
  /**
   * A lead created from a booking of one of these services (case-insensitive "contains") is at
   * Proposal sent. Bookings never make a lead Won: only a signed Goodshuffle contract does.
   */
  proposalServices: z.array(z.string()).default([]),
  /**
   * Planners & partners: emails ("kate@planner.ca") or whole domains ("@planner.ca"). Their bookings
   * show in the Consultations panel but never create a lead, move a status or set a follow-up.
   */
  excludeContacts: z.array(z.string()).default([]),
});

export const mailboxSchema = z.object({
  /** first mailbox sync reads this many days back */
  backfillDays: z.number().int().min(1).default(700),
  /** messages read per folder per sync (a large backlog is worked through over several syncs) */
  batchSize: z.number().int().min(50).default(1500),
  /** an email sent this long after a follow-up's due time still counts as doing it (hours) */
  followUpGraceHours: z.number().min(0).default(12),
});

function DEFAULT_SMS() {
  return {
    senderName: "Luxel Decor & Flowers",
    consentDays: 183,
    minDaysBetween: 3,
    templates: [
      { label: "Check in", body: "Hi {first_name}, it's {sender}. Just checking in on your {event}{event_date}. Do you have any questions we can help with?" },
      { label: "Quote follow-up", body: "Hi {first_name}, it's {sender}. Did you get a chance to look at the quote for your {event}{event_date}? Happy to walk you through it or adjust anything." },
      { label: "Book a consultation", body: "Hi {first_name}, it's {sender}. We'd love to show you ideas for your {event}{venue}. Would a quick call or a studio visit this week work for you?" },
      { label: "Last check", body: "Hi {first_name}, it's {sender}. We haven't heard back, so we'll close your file for now. If your {event} plans are still on, just reply and we'll pick it up." },
    ],
  };
}

export const smsTemplateSchema = z.object({ label: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(640) });
export const smsSchema = z.object({
  /** who the text says it's from (CASL: identify the sender), e.g. "Mansi from Luxel Decor" */
  senderName: z.string().trim().min(1).max(80).default("Luxel Decor & Flowers"),
  /** CASL implied consent from an inquiry lasts 6 months: no texts to leads who inquired longer ago */
  consentDays: z.number().int().min(1).max(730).default(183),
  /** at most one text per lead in this many days */
  minDaysBetween: z.number().int().min(0).default(3),
  /** placeholders: {first_name} {event} {event_date} {venue} {sender}. "Reply STOP to opt out." is added if missing */
  templates: z.array(smsTemplateSchema).min(1),
});

export const settingsSchema = z.object({
  businessHours: businessHoursSchema,
  sms: smsSchema.default(DEFAULT_SMS()),
  mailbox: mailboxSchema.default({ backfillDays: 700, batchSize: 1500, followUpGraceHours: 12 }),
  setmore: setmoreSchema.default({ proposalServices: ["existing booking", "quote review"], excludeContacts: [] }),
  ops: opsSchema.default({ setupSteps: [], teardownSteps: [], keepDaysAfter: 14 }),
  followUps: followUpSchema,
  utmRules: z.array(utmRuleSchema),
  referrerRules: z.array(z.object({ domain: z.string(), result: z.enum(SOURCES) })),
});

export type Settings = z.infer<typeof settingsSchema>;

/** GTA + Golden Horseshoe, including the neighbourhood / former-municipality names people actually type. */
export const DEFAULT_SERVICE_AREA = [
  "Toronto", "North York", "Scarborough", "Etobicoke", "East York", "York", "Downtown Toronto",
  "Vaughan", "Woodbridge", "Maple", "Concord", "Kleinburg", "Thornhill",
  "Markham", "Unionville", "Richmond Hill", "Mississauga", "Brampton", "Bolton",
  "Oakville", "Burlington", "Hamilton", "Stoney Creek", "Ancaster", "Dundas", "Grimsby",
  "Pickering", "Ajax", "Whitby", "Oshawa", "Clarington", "Bowmanville", "Uxbridge",
  "Newmarket", "Aurora", "King City", "King", "Nobleton", "Stouffville", "Whitchurch-Stouffville",
  "East Gwillimbury", "Georgina", "Caledon", "Milton", "Halton Hills", "Georgetown",
  "Niagara", "Niagara Falls", "Niagara-on-the-Lake", "St. Catharines", "Welland", "Lincoln",
  "Kitchener", "Waterloo", "Kitchener-Waterloo", "Cambridge", "Guelph", "Barrie", "Innisfil",
];

export const DEFAULT_SETTINGS: Settings = {
  sms: DEFAULT_SMS(),
  mailbox: { backfillDays: 700, batchSize: 1500, followUpGraceHours: 12 },
  setmore: { proposalServices: ["existing booking", "quote review"], excludeContacts: [] },

  ops: {
    setupSteps: ["Pull and check {area} items", "Load {area} onto the truck", "Set up {area}", "Photo of {area} when finished"],
    teardownSteps: ["Strike {area}", "Count and pack {area} items", "Load {area} back onto the truck", "Note anything damaged or missing ({area})"],
    keepDaysAfter: 14,
  },
  businessHours: { timezone: "America/Toronto", days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 },
  followUps: {
    firstResponseBusinessHours: 2,
    afterContactedDays: 2,
    beforeConsultDays: 1,
    afterProposalDays: 3,
    newLeadNoContactHours: 24,
    digestHour: 8,
    freshInquiryDays: 14,
    chaseQuoteDays: 7,
  },
  utmRules: [
    { source: "google", medium: "cpc", result: "google_ads" },
    { source: "google", medium: "ppc", result: "google_ads" },
    { source: "google", medium: "paid", result: "google_ads" },
    { source: "adwords", medium: "*", result: "google_ads" },
    { source: "gbp", medium: "*", result: "google_business_profile" },
    { source: "google", medium: "organic_gbp", result: "google_business_profile" },
    { source: "google_business_profile", medium: "*", result: "google_business_profile" },
    { source: "gmb", medium: "*", result: "google_business_profile" },
    { source: "google", medium: "organic", result: "organic_search" },
    { source: "bing", medium: "organic", result: "organic_search" },
    { source: "instagram", medium: "*", result: "instagram" },
    { source: "ig", medium: "*", result: "instagram" },
    { source: "facebook", medium: "*", result: "facebook" },
    { source: "fb", medium: "*", result: "facebook" },
    { source: "meta", medium: "*", result: "facebook" },
    { source: "newsletter", medium: "*", result: "email" },
    { source: "*", medium: "email", result: "email" },
    { source: "*", medium: "referral", result: "referral" },
    { source: "venue", medium: "*", result: "venue_partner" },
    { source: "*", medium: "venue_partner", result: "venue_partner" },
    { source: "weddingshow", medium: "*", result: "wedding_show" },
    { source: "wedding_show", medium: "*", result: "wedding_show" },
  ],
  referrerRules: [
    { domain: "google.", result: "organic_search" },
    { domain: "bing.com", result: "organic_search" },
    { domain: "duckduckgo.com", result: "organic_search" },
    { domain: "yahoo.com", result: "organic_search" },
    { domain: "instagram.com", result: "instagram" },
    { domain: "l.instagram.com", result: "instagram" },
    { domain: "facebook.com", result: "facebook" },
    { domain: "fb.com", result: "facebook" },
    { domain: "m.facebook.com", result: "facebook" },
    { domain: "l.facebook.com", result: "facebook" },
  ],
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsOverrides = DeepPartial<Settings>;

/** Deep-merge org overrides over defaults. Arrays replace wholesale. */
export function resolveSettings(overrides: unknown): Settings {
  const merge = (base: any, over: any): any => {
    if (over === undefined || over === null) return base;
    if (Array.isArray(base) || typeof base !== "object") return over;
    const out: any = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  };
  const merged = merge(DEFAULT_SETTINGS, overrides ?? {});
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
