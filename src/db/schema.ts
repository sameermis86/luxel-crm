import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  real,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const EVENT_TYPES = ["wedding", "corporate", "social", "rental_only", "other"] as const;
export const TIERS = ["effortless", "elegant", "elevated", "custom"] as const;
export const SOURCES = [
  "quote_builder",
  "contact_us_form",
  "instagram",
  "facebook",
  "google_ads",
  "google_business_profile",
  "organic_search",
  "referral",
  "venue_partner",
  "wedding_show",
  "phone",
  "email",
  "walk_in",
  "other",
] as const;
export const STATUSES = [
  "new",
  "contacted",
  "consult_scheduled",
  "consult_held",
  "proposal_sent",
  "won",
  "lost",
  "unqualified",
  "on_hold",
] as const;
export const QUALIFICATIONS = ["qualified", "unqualified", "needs_info"] as const;
export const ROLES = ["owner", "manager", "staff"] as const;
export const ACTOR_KINDS = ["user", "system", "webhook", "import"] as const;
export const EVENT_KINDS = [
  "created",
  "field_changed",
  "status_changed",
  "assigned",
  "scored",
  "qualified",
  "note_added",
  "call_logged",
  "email_logged",
  "meeting_logged",
  "follow_up_set",
  "follow_up_done",
  "merged",
  "imported",
  "converted",
  "returning_inquiry",
  "archived",
] as const;
export const CAMPAIGN_CHANNELS = ["google_ads", "meta_ads", "instagram", "wedding_show", "email", "other"] as const;
export const LOST_REASONS = ["price", "date_unavailable", "went_with_competitor", "no_response", "out_of_scope", "other"] as const;
export const DUP_STATUS = ["open", "merged", "dismissed"] as const;
export const CONFIDENCE = ["high", "medium"] as const;

export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);
export const tierEnum = pgEnum("tier", TIERS);
export const sourceEnum = pgEnum("lead_source", SOURCES);
export const statusEnum = pgEnum("lead_status", STATUSES);
export const qualificationEnum = pgEnum("qualification", QUALIFICATIONS);
export const roleEnum = pgEnum("user_role", ROLES);
export const actorKindEnum = pgEnum("actor_kind", ACTOR_KINDS);
export const eventKindEnum = pgEnum("lead_event_type", EVENT_KINDS);
export const campaignChannelEnum = pgEnum("campaign_channel", CAMPAIGN_CHANNELS);
export const lostReasonEnum = pgEnum("lost_reason", LOST_REASONS);
export const dupStatusEnum = pgEnum("duplicate_status", DUP_STATUS);
export const confidenceEnum = pgEnum("match_confidence", CONFIDENCE);

export type EventType = (typeof EVENT_TYPES)[number];
export type Tier = (typeof TIERS)[number];
export type Source = (typeof SOURCES)[number];
export type Status = (typeof STATUSES)[number];
export type Qualification = (typeof QUALIFICATIONS)[number];
export type Role = (typeof ROLES)[number];
export type ActorKind = (typeof ACTOR_KINDS)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type LostReason = (typeof LOST_REASONS)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

/* -------------------------------------------------------------------------- */
/* Tenancy + users                                                            */
/* -------------------------------------------------------------------------- */

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Toronto"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    authUserId: uuid("auth_user_id"), // Supabase auth.users.id
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    acceptsLeads: boolean("accepts_leads").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_org_email_uq").on(t.orgId, t.email)],
);

/** Per-org tunables (scoring weights, qualification thresholds, service area, business hours). */
export const orgSettings = pgTable("org_settings", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* -------------------------------------------------------------------------- */

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    name: text("name").notNull(),
    channel: campaignChannelEnum("channel").notNull().default("other"),
    utmCampaign: text("utm_campaign"), // match key (stored lower-case)
    startDate: date("start_date"),
    endDate: date("end_date"),
    spend: money("spend"),
    reviewed: boolean("reviewed").notNull().default(true), // false = auto-created from an unknown utm_campaign
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaigns_org_utm_uq").on(t.orgId, t.utmCampaign)],
);

/* -------------------------------------------------------------------------- */
/* Imports                                                                    */
/* -------------------------------------------------------------------------- */

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  fileName: text("file_name").notNull(),
  source: sourceEnum("source"),
  preset: text("preset"),
  rowCount: integer("row_count").notNull().default(0),
  created: integer("created").notNull().default(0),
  merged: integer("merged").notNull().default(0),
  duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
  errors: jsonb("errors").notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  undoneAt: ts("undone_at"),
  undoneBy: uuid("undone_by").references(() => users.id),
});

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: text("record_id")
      .notNull()
      .unique()
      .default(sql`'LX-' || lpad(nextval('lead_record_seq')::text, 6, '0')`),
    orgId: uuid("org_id").notNull().references(() => orgs.id),

    firstName: text("first_name"),
    lastName: text("last_name"),
    partnerName: text("partner_name"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    phoneE164: text("phone_e164"),

    eventType: eventTypeEnum("event_type").notNull().default("other"),
    eventDate: date("event_date"),
    venueName: text("venue_name"),
    venueCity: text("venue_city"),
    guestCount: integer("guest_count"),
    budgetMin: money("budget_min"),
    budgetMax: money("budget_max"),
    estimateTotal: money("estimate_total"), // from the Quote Builder
    servicesRequested: text("services_requested").array().notNull().default(sql`'{}'::text[]`),
    tierInterest: tierEnum("tier_interest"),
    message: text("message"),

    source: sourceEnum("source").notNull().default("other"), // origin: what brought them
    captureChannel: sourceEnum("capture_channel"), // how they reached us (form/channel)
    sourceDetail: text("source_detail"),
    campaignId: uuid("campaign_id").references(() => campaigns.id),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    landingPage: text("landing_page"),
    referrerUrl: text("referrer_url"),

    status: statusEnum("status").notNull().default("new"),
    lostReason: lostReasonEnum("lost_reason"),
    lostReasonDetail: text("lost_reason_detail"),
    unqualifiedReason: text("unqualified_reason"),

    score: integer("score").notNull().default(0),
    scoreBreakdown: jsonb("score_breakdown").notNull().default({}),
    qualification: qualificationEnum("qualification").notNull().default("needs_info"),
    qualificationReasons: text("qualification_reasons").array().notNull().default(sql`'{}'::text[]`),
    qualificationOverride: boolean("qualification_override").notNull().default(false),
    qualificationOverrideReason: text("qualification_override_reason"),

    ownerId: uuid("owner_id").references(() => users.id),
    nextFollowUpAt: ts("next_follow_up_at"),
    lastContactedAt: ts("last_contacted_at"),
    firstReplyAt: ts("first_reply_at"),

    quoteValue: money("quote_value"),
    contractValue: money("contract_value"),
    collectedAmount: money("collected_amount"),

    // stage entry timestamps (first time the lead entered each stage) + furthest funnel stage
    contactedAt: ts("contacted_at"),
    consultScheduledAt: ts("consult_scheduled_at"),
    consultHeldAt: ts("consult_held_at"),
    proposalSentAt: ts("proposal_sent_at"),
    wonAt: ts("won_at"),
    lostAt: ts("lost_at"),
    furthestStage: integer("furthest_stage").notNull().default(0),

    duplicateOfId: uuid("duplicate_of_id"),
    returningInquiry: boolean("returning_inquiry").notNull().default(false),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    archivedAt: ts("archived_at"),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    index("leads_org_created_idx").on(t.orgId, t.createdAt),
    index("leads_email_norm_idx").on(t.orgId, t.emailNormalized),
    index("leads_phone_idx").on(t.orgId, t.phoneE164),
    index("leads_owner_idx").on(t.orgId, t.ownerId),
    index("leads_status_idx").on(t.orgId, t.status),
    index("leads_follow_up_idx").on(t.orgId, t.nextFollowUpAt),
    index("leads_name_trgm_idx").using(
      "gin",
      sql`(lower(coalesce(${t.firstName},'') || ' ' || coalesce(${t.lastName},''))) gin_trgm_ops`,
    ),
  ],
);

/**
 * Append-only audit trail. The app role only has SELECT + INSERT, and a trigger
 * rejects UPDATE/DELETE for everyone (including the table owner).
 */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.id),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    at: ts("at").notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id),
    actorKind: actorKindEnum("actor_kind").notNull(),
    type: eventKindEnum("type").notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    payload: jsonb("payload"),
  },
  (t) => [index("lead_events_lead_idx").on(t.leadId, t.at), index("lead_events_org_type_idx").on(t.orgId, t.type, t.at)],
);

/** Idempotency ledger for webhook submissions. */
export const intakeSubmissions = pgTable(
  "intake_submissions",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    submissionId: text("submission_id").notNull(),
    form: text("form").notNull(),
    leadId: uuid("lead_id").references(() => leads.id),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.submissionId] })],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    leadId: uuid("lead_id").notNull().references(() => leads.id),
    dueAt: ts("due_at").notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    note: text("note"),
    doneAt: ts("done_at"),
    doneBy: uuid("done_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("follow_ups_owner_due_idx").on(t.orgId, t.ownerId, t.dueAt), index("follow_ups_lead_idx").on(t.leadId)],
);

export const assignmentRules = pgTable("assignment_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  priority: integer("priority").notNull(),
  conditions: jsonb("conditions").notNull().default({}),
  assignToUserId: uuid("assign_to_user_id").references(() => users.id),
  /** null + assignToUserId null = round robin across everyone who accepts leads */
  roundRobinPool: uuid("round_robin_pool").array(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    leadA: uuid("lead_a").notNull().references(() => leads.id),
    leadB: uuid("lead_b").notNull().references(() => leads.id),
    matchReasons: text("match_reasons").array().notNull(),
    confidence: confidenceEnum("confidence").notNull(),
    similarity: real("similarity"),
    status: dupStatusEnum("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dup_pair_uq").on(t.leadA, t.leadB)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    leadId: uuid("lead_id").references(() => leads.id),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  query: text("query").notNull(), // URL query string of the leads list
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type User = typeof users.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AssignmentRule = typeof assignmentRules.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
