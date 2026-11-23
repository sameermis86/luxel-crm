CREATE TABLE "integration_state" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_state_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
ALTER TABLE "integration_state" ADD CONSTRAINT "integration_state_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON integration_state TO luxel_app;
--> statement-breakpoint
ALTER TABLE integration_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_state_read ON integration_state FOR SELECT USING (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY integration_state_write ON integration_state FOR ALL USING (org_id = app.org_id() AND app.is_owner()) WITH CHECK (org_id = app.org_id() AND app.is_owner());
