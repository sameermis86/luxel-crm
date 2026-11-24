ALTER TYPE "public"."lead_event_type" ADD VALUE 'text_logged' BEFORE 'follow_up_set';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sms_opt_out_at" timestamp with time zone;