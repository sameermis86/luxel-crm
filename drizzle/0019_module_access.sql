CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "user_access" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"level" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "user_access_user_id_module_pk" PRIMARY KEY("user_id","module")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sessions_valid_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_module_chk" CHECK ("module" IN ('sales','ops','floral','finance','admin'));--> statement-breakpoint
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_level_chk" CHECK ("level" IN ('none','view','edit','manage'));--> statement-breakpoint

-- =====================================================================
-- Module access. Owners (and system jobs) always have full access; for others an explicit
-- user_access row wins, else the role's default (mirrored in src/lib/access.ts, a test keeps them equal).
-- levels: 0 none, 1 view, 2 edit, 3 manage
-- =====================================================================
CREATE OR REPLACE FUNCTION app.default_access(p_role text, p_module text) RETURNS int LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE
     WHEN p_role IN ('owner', 'system') THEN 3
     WHEN p_role = 'manager' AND p_module = 'sales' THEN 3
     WHEN p_role = 'manager' AND p_module = 'ops' THEN 2
     WHEN p_role = 'staff' AND p_module IN ('sales', 'ops') THEN 2
     ELSE 0 END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.level_num(p_level text) RETURNS int LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE p_level WHEN 'manage' THEN 3 WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0 END $$;
--> statement-breakpoint
-- SECURITY DEFINER: reads user_access regardless of the caller's own policies (it only ever answers for the caller).
CREATE OR REPLACE FUNCTION app.access_level(p_module text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT CASE
     WHEN app.role() IN ('owner', 'system') THEN 3
     WHEN app.user_id() IS NULL THEN 0
     ELSE coalesce(
       (SELECT app.level_num(a.level) FROM user_access a WHERE a.org_id = app.org_id() AND a.user_id = app.user_id() AND a.module = p_module),
       app.default_access(app.role(), p_module))
   END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_access(p_module text, p_level int) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app.access_level(p_module) >= p_level $$;
--> statement-breakpoint
-- for sign-in: a user's effective levels (called before any request context exists)
CREATE OR REPLACE FUNCTION app.user_modules(p_org uuid, p_user uuid)
  RETURNS TABLE (module text, level int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT m.module,
          CASE WHEN u.role = 'owner' THEN 3
               ELSE coalesce((SELECT app.level_num(a.level) FROM user_access a WHERE a.org_id = p_org AND a.user_id = u.id AND a.module = m.module),
                             app.default_access(u.role::text, m.module)) END
     FROM users u CROSS JOIN (VALUES ('sales'), ('ops'), ('floral'), ('finance'), ('admin')) AS m(module)
    WHERE u.org_id = p_org AND u.id = p_user AND u.active $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.access_level(text), app.user_modules(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.default_access(text, text), app.level_num(text), app.access_level(text), app.has_access(text, int), app.user_modules(uuid, uuid) TO luxel_app;--> statement-breakpoint

-- sign-in lookup also returns when sessions were last revoked
DROP FUNCTION app.resolve_user(uuid, uuid, text);--> statement-breakpoint
CREATE FUNCTION app.resolve_user(p_org uuid, p_auth_user_id uuid, p_email text)
  RETURNS TABLE (id uuid, org_id uuid, name text, email text, role user_role, active boolean, sessions_valid_after timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  IF p_auth_user_id IS NOT NULL THEN
    UPDATE users u SET auth_user_id = p_auth_user_id
     WHERE u.org_id = p_org AND u.auth_user_id IS NULL AND lower(u.email) = lower(p_email);
  END IF;
  RETURN QUERY
    SELECT u.id, u.org_id, u.name, u.email, u.role, u.active, u.sessions_valid_after FROM users u
     WHERE u.org_id = p_org AND u.active
       AND ((p_auth_user_id IS NOT NULL AND u.auth_user_id = p_auth_user_id)
            OR (p_auth_user_id IS NULL AND lower(u.email) = lower(p_email)));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_user(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_user(uuid, uuid, text) TO luxel_app;--> statement-breakpoint

-- new tables
GRANT SELECT, INSERT, UPDATE, DELETE ON user_access TO luxel_app;--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO luxel_app;--> statement-breakpoint
ALTER TABLE user_access ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY user_access_read ON user_access FOR SELECT USING (org_id = app.org_id() AND (user_id = app.user_id() OR app.has_access('admin', 3)));--> statement-breakpoint
CREATE POLICY user_access_write ON user_access FOR ALL USING (org_id = app.org_id() AND app.has_access('admin', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('admin', 3));--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_log_read ON audit_log FOR SELECT USING (org_id = app.org_id() AND app.has_access('admin', 3));--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (org_id = app.org_id());--> statement-breakpoint
-- append-only, like lead_events
CREATE OR REPLACE FUNCTION app.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION app.audit_log_immutable();--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION app.audit_log_immutable();--> statement-breakpoint

-- Admin (settings, team, rules, integrations) is now a module level, not "is owner"
DROP POLICY users_write ON users;--> statement-breakpoint
CREATE POLICY users_write ON users FOR ALL USING (org_id = app.org_id() AND app.has_access('admin', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('admin', 3));--> statement-breakpoint
DROP POLICY settings_write ON org_settings;--> statement-breakpoint
CREATE POLICY settings_write ON org_settings FOR ALL USING (org_id = app.org_id() AND app.has_access('admin', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('admin', 3));--> statement-breakpoint
DROP POLICY rules_write ON assignment_rules;--> statement-breakpoint
CREATE POLICY rules_write ON assignment_rules FOR ALL USING (org_id = app.org_id() AND app.has_access('admin', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('admin', 3));--> statement-breakpoint
DROP POLICY integration_state_write ON integration_state;--> statement-breakpoint
CREATE POLICY integration_state_write ON integration_state FOR ALL USING (org_id = app.org_id() AND app.has_access('admin', 3)) WITH CHECK (org_id = app.org_id() AND app.has_access('admin', 3));--> statement-breakpoint

-- Module gates on top of the existing (permissive) policies: RESTRICTIVE policies are ANDed with them.
-- Sales & CRM: reading needs view, changing needs edit.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','lead_events','follow_ups','duplicate_candidates','intake_submissions','appointments','saved_views','import_batches'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (app.has_access(''sales'', 1))', t || '_module_read', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app.has_access(''sales'', 2))', t || '_module_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (app.has_access(''sales'', 2))', t || '_module_update', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (app.has_access(''sales'', 2))', t || '_module_delete', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ops_events','ops_items','ops_tasks'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (app.has_access(''ops'', 1))', t || '_module_read', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app.has_access(''ops'', 2))', t || '_module_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (app.has_access(''ops'', 2))', t || '_module_update', t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (app.has_access(''ops'', 2))', t || '_module_delete', t);
  END LOOP;
END $$;
