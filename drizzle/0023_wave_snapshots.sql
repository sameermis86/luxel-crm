CREATE TABLE "wave_balance_snapshots" (
	"org_id" uuid NOT NULL,
	"wave_id" text NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"balance" numeric(12, 2),
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wave_balance_snapshots_org_id_wave_id_day_pk" PRIMARY KEY("org_id","wave_id","day")
);
--> statement-breakpoint
ALTER TABLE "wave_balance_snapshots" ADD CONSTRAINT "wave_balance_snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wave_snapshots_day_idx" ON "wave_balance_snapshots" USING btree ("org_id","day");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON wave_balance_snapshots TO luxel_app;--> statement-breakpoint
ALTER TABLE wave_balance_snapshots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY wave_snapshots_read ON wave_balance_snapshots FOR SELECT USING (org_id = app.org_id() AND app.has_access('finance', 1));--> statement-breakpoint
CREATE POLICY wave_snapshots_write ON wave_balance_snapshots FOR ALL USING (org_id = app.org_id() AND app.has_access('finance', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('finance', 3));
