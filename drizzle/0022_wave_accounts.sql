CREATE TABLE "wave_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"wave_id" text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"display_id" text,
	"type" text NOT NULL,
	"subtype" text,
	"normal_balance" text,
	"archived" boolean DEFAULT false NOT NULL,
	"balance" numeric(12, 2),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wave_accounts" ADD CONSTRAINT "wave_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wave_accounts_org_wave_uq" ON "wave_accounts" USING btree ("org_id","wave_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON wave_accounts TO luxel_app;--> statement-breakpoint
ALTER TABLE wave_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY wave_accounts_read ON wave_accounts FOR SELECT USING (org_id = app.org_id() AND app.has_access('finance', 1));--> statement-breakpoint
CREATE POLICY wave_accounts_write ON wave_accounts FOR ALL USING (org_id = app.org_id() AND app.has_access('finance', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('finance', 3));
