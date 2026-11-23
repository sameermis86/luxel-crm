CREATE TYPE "public"."actor_kind" AS ENUM('user', 'system', 'webhook', 'import');--> statement-breakpoint
CREATE TYPE "public"."campaign_channel" AS ENUM('google_ads', 'meta_ads', 'instagram', 'wedding_show', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."match_confidence" AS ENUM('high', 'medium');--> statement-breakpoint
CREATE TYPE "public"."duplicate_status" AS ENUM('open', 'merged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."lead_event_type" AS ENUM('created', 'field_changed', 'status_changed', 'assigned', 'scored', 'qualified', 'note_added', 'call_logged', 'email_logged', 'meeting_logged', 'follow_up_set', 'follow_up_done', 'merged', 'imported', 'converted', 'returning_inquiry', 'archived');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('wedding', 'corporate', 'social', 'rental_only', 'other');--> statement-breakpoint
CREATE TYPE "public"."lost_reason" AS ENUM('price', 'date_unavailable', 'went_with_competitor', 'no_response', 'out_of_scope', 'other');--> statement-breakpoint
CREATE TYPE "public"."qualification" AS ENUM('qualified', 'unqualified', 'needs_info');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('quote_builder', 'contact_us_form', 'instagram', 'facebook', 'google_ads', 'google_business_profile', 'organic_search', 'referral', 'venue_partner', 'wedding_show', 'phone', 'email', 'walk_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'consult_scheduled', 'consult_held', 'proposal_sent', 'won', 'lost', 'unqualified', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('effortless', 'elegant', 'elevated', 'custom');--> statement-breakpoint
CREATE TABLE "assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assign_to_user_id" uuid,
	"round_robin_pool" uuid[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "campaign_channel" DEFAULT 'other' NOT NULL,
	"utm_campaign" text,
	"start_date" date,
	"end_date" date,
	"spend" numeric(12, 2),
	"reviewed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_a" uuid NOT NULL,
	"lead_b" uuid NOT NULL,
	"match_reasons" text[] NOT NULL,
	"confidence" "match_confidence" NOT NULL,
	"similarity" real,
	"status" "duplicate_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"owner_id" uuid,
	"note" text,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"source" "lead_source",
	"preset" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"duplicates_skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid
);
--> statement-breakpoint
CREATE TABLE "intake_submissions" (
	"org_id" uuid NOT NULL,
	"submission_id" text NOT NULL,
	"form" text NOT NULL,
	"lead_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_submissions_org_id_submission_id_pk" PRIMARY KEY("org_id","submission_id")
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"type" "lead_event_type" NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" text DEFAULT 'LX-' || lpad(nextval('lead_record_seq')::text, 6, '0') NOT NULL,
	"org_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"partner_name" text,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"phone_e164" text,
	"event_type" "event_type" DEFAULT 'other' NOT NULL,
	"event_date" date,
	"venue_name" text,
	"venue_city" text,
	"guest_count" integer,
	"budget_min" numeric(12, 2),
	"budget_max" numeric(12, 2),
	"estimate_total" numeric(12, 2),
	"services_requested" text[] DEFAULT '{}'::text[] NOT NULL,
	"tier_interest" "tier",
	"message" text,
	"source" "lead_source" DEFAULT 'other' NOT NULL,
	"capture_channel" "lead_source",
	"source_detail" text,
	"campaign_id" uuid,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"landing_page" text,
	"referrer_url" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"lost_reason" "lost_reason",
	"lost_reason_detail" text,
	"unqualified_reason" text,
	"score" integer DEFAULT 0 NOT NULL,
	"score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qualification" "qualification" DEFAULT 'needs_info' NOT NULL,
	"qualification_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"qualification_override" boolean DEFAULT false NOT NULL,
	"qualification_override_reason" text,
	"owner_id" uuid,
	"next_follow_up_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"first_reply_at" timestamp with time zone,
	"quote_value" numeric(12, 2),
	"contract_value" numeric(12, 2),
	"collected_amount" numeric(12, 2),
	"contacted_at" timestamp with time zone,
	"consult_scheduled_at" timestamp with time zone,
	"consult_held_at" timestamp with time zone,
	"proposal_sent_at" timestamp with time zone,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"furthest_stage" integer DEFAULT 0 NOT NULL,
	"duplicate_of_id" uuid,
	"returning_inquiry" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "leads_record_id_unique" UNIQUE("record_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"lead_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"accepts_leads" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_assign_to_user_id_users_id_fk" FOREIGN KEY ("assign_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_lead_a_leads_id_fk" FOREIGN KEY ("lead_a") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_lead_b_leads_id_fk" FOREIGN KEY ("lead_b") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_utm_uq" ON "campaigns" USING btree ("org_id","utm_campaign");--> statement-breakpoint
CREATE UNIQUE INDEX "dup_pair_uq" ON "duplicate_candidates" USING btree ("lead_a","lead_b");--> statement-breakpoint
CREATE INDEX "follow_ups_owner_due_idx" ON "follow_ups" USING btree ("org_id","owner_id","due_at");--> statement-breakpoint
CREATE INDEX "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX "lead_events_org_type_idx" ON "lead_events" USING btree ("org_id","type","at");--> statement-breakpoint
CREATE INDEX "leads_org_created_idx" ON "leads" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_email_norm_idx" ON "leads" USING btree ("org_id","email_normalized");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("org_id","phone_e164");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("org_id","owner_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("org_id","next_follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_name_trgm_idx" ON "leads" USING gin ((lower(coalesce("first_name",'') || ' ' || coalesce("last_name",''))) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_uq" ON "users" USING btree ("org_id","email");