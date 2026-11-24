CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"lead_id" uuid,
	"customer_external_id" text,
	"customer_name" text,
	"email" text,
	"email_normalized" text,
	"phone_e164" text,
	"service_name" text,
	"staff_name" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text NOT NULL,
	"label" text,
	"notes" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_org_source_ext" ON "appointments" USING btree ("org_id","source","external_id");--> statement-breakpoint
CREATE INDEX "appointments_org_starts" ON "appointments" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_lead" ON "appointments" USING btree ("lead_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON appointments TO luxel_app;
--> statement-breakpoint
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY appointments_org ON appointments FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
