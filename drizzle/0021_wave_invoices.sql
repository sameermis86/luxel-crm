CREATE TABLE "wave_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"wave_id" text NOT NULL,
	"business_id" text NOT NULL,
	"invoice_number" text,
	"status" text NOT NULL,
	"title" text,
	"po_number" text,
	"invoice_date" date,
	"due_date" date,
	"customer_name" text,
	"total" numeric(12, 2),
	"amount_due" numeric(12, 2),
	"currency" text,
	"view_url" text,
	"project" text,
	"contract_id" uuid,
	"wave_modified_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wave_invoices" ADD CONSTRAINT "wave_invoices_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wave_invoices" ADD CONSTRAINT "wave_invoices_contract_id_finance_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."finance_contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wave_invoices_org_wave_uq" ON "wave_invoices" USING btree ("org_id","wave_id");--> statement-breakpoint
CREATE INDEX "wave_invoices_contract_idx" ON "wave_invoices" USING btree ("contract_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON wave_invoices TO luxel_app;--> statement-breakpoint
ALTER TABLE wave_invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Finance: reading needs finance view; only the sync (system) or Finance managers write
CREATE POLICY wave_invoices_read ON wave_invoices FOR SELECT USING (org_id = app.org_id() AND app.has_access('finance', 1));--> statement-breakpoint
CREATE POLICY wave_invoices_write ON wave_invoices FOR ALL USING (org_id = app.org_id() AND app.has_access('finance', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('finance', 3));
