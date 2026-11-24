-- Campaign management and revenue tracking removed (revenue lives in the proposals tool).
-- The raw utm_campaign value on leads is kept as source attribution. Past field changes stay in lead_events.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "campaign_id";
--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "contract_value";
--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "collected_amount";
--> statement-breakpoint
DROP TABLE IF EXISTS "campaigns" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."campaign_channel";
