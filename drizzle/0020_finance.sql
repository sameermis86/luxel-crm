CREATE TABLE "finance_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project" text NOT NULL,
	"lead_id" uuid,
	"name" text,
	"client" text,
	"event_date" date,
	"status" text,
	"total" numeric(12, 2),
	"paid" numeric(12, 2),
	"balance" numeric(12, 2),
	"currency" text DEFAULT 'CAD' NOT NULL,
	"import_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"filename" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_contracts" ADD CONSTRAINT "finance_contracts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_contracts" ADD CONSTRAINT "finance_contracts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_imports" ADD CONSTRAINT "finance_imports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_imports" ADD CONSTRAINT "finance_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_contracts_org_project_uq" ON "finance_contracts" USING btree ("org_id","project");--> statement-breakpoint
CREATE INDEX "finance_contracts_event_idx" ON "finance_contracts" USING btree ("org_id","event_date");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON finance_contracts, finance_imports TO luxel_app;--> statement-breakpoint
ALTER TABLE finance_contracts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE finance_imports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Finance: reading needs finance view; importing (any write) needs finance manage
CREATE POLICY finance_contracts_read ON finance_contracts FOR SELECT USING (org_id = app.org_id() AND app.has_access('finance', 1));--> statement-breakpoint
CREATE POLICY finance_contracts_write ON finance_contracts FOR ALL USING (org_id = app.org_id() AND app.has_access('finance', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('finance', 3));--> statement-breakpoint
CREATE POLICY finance_imports_read ON finance_imports FOR SELECT USING (org_id = app.org_id() AND app.has_access('finance', 1));--> statement-breakpoint
CREATE POLICY finance_imports_write ON finance_imports FOR ALL USING (org_id = app.org_id() AND app.has_access('finance', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('finance', 3));
