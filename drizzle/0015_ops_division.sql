CREATE TABLE "ops_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project" text NOT NULL,
	"gs_uid" text,
	"gs_status" text NOT NULL,
	"lead_id" uuid,
	"name" text NOT NULL,
	"client" text,
	"venue" text,
	"event_date" date NOT NULL,
	"time_text" text,
	"sales_lead" text,
	"notes_internal" text,
	"notes_client" text,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gone_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"parent_id" uuid,
	"area" text NOT NULL,
	"name" text NOT NULL,
	"qty" numeric DEFAULT 1 NOT NULL,
	"logistics" boolean DEFAULT false NOT NULL,
	"from_gs" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"pulled_at" timestamp with time zone,
	"pulled_by" uuid,
	"loaded_at" timestamp with time zone,
	"loaded_by" uuid,
	"returned_at" timestamp with time zone,
	"returned_by" uuid,
	"returned_qty" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_events" ADD CONSTRAINT "ops_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_events" ADD CONSTRAINT "ops_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_items" ADD CONSTRAINT "ops_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_items" ADD CONSTRAINT "ops_items_event_id_ops_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."ops_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_items" ADD CONSTRAINT "ops_items_pulled_by_users_id_fk" FOREIGN KEY ("pulled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_items" ADD CONSTRAINT "ops_items_loaded_by_users_id_fk" FOREIGN KEY ("loaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_items" ADD CONSTRAINT "ops_items_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_event_id_ops_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."ops_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_tasks" ADD CONSTRAINT "ops_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ops_events_org_project" ON "ops_events" USING btree ("org_id","project");--> statement-breakpoint
CREATE INDEX "ops_events_org_date" ON "ops_events" USING btree ("org_id","event_date");--> statement-breakpoint
CREATE INDEX "ops_items_event" ON "ops_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ops_tasks_event" ON "ops_tasks" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_tasks_auto_unique" ON "ops_tasks" USING btree ("event_id","phase","area","title");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ops_events, ops_items, ops_tasks TO luxel_app;
--> statement-breakpoint
ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ops_events_org ON ops_events FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY ops_items_org ON ops_items FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY ops_tasks_org ON ops_tasks FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
