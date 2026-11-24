import { z } from "zod";
import { EVENT_TYPES, SOURCES } from "@/db/schema";

/**
 * Every tunable number in the CRM lives here. Owners can override any of these
 * per org in Settings (stored in org_settings.settings, deep-merged over these).
 */

export const qualificationSchema = z.object({
  minBudget: z.number(),
  minLeadTimeDays: z.number(),
  requireEventDateForQualified: z.boolean(),
  serviceArea: z.array(z.string()),
});

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

export const settingsSchema = z.object({
  qualification: qualificationSchema,
  businessHours: businessHoursSchema,
  followUps: followUpSchema,
  utmRules: z.array(utmRuleSchema),
  referrerRules: z.array(z.object({ domain: z.string(), result: z.enum(SOURCES) })),
});

export type Settings = z.infer<typeof settingsSchema>;
export type QualificationConfig = Settings["qualification"];

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
  qualification: {
    minBudget: 2000,
    minLeadTimeDays: 14,
    requireEventDateForQualified: true,
    serviceArea: DEFAULT_SERVICE_AREA,
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
