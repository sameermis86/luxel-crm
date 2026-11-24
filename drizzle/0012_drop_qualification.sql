ALTER TYPE "public"."lead_source" ADD VALUE 'goodshuffle' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "qualification";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "qualification_reasons";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "qualification_override";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "qualification_override_reason";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."qualification";