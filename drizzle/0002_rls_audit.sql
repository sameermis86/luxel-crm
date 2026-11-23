-- =====================================================================
-- Request context helpers. The app sets these per transaction:
--   set_config('app.org_id', ..., true), 'app.user_id', 'app.role'
-- role is one of owner | manager | staff | system
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.org_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'none') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sees_all_leads() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app.role() IN ('owner', 'manager', 'system') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_owner() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT app.role() IN ('owner', 'system') $$;
--> statement-breakpoint

-- =====================================================================
-- Append-only audit trail: nobody may UPDATE, DELETE or TRUNCATE lead_events.
-- =====================================================================
CREATE OR REPLACE FUNCTION app.lead_events_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'lead_events is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege'; END $$;
--> statement-breakpoint
CREATE TRIGGER lead_events_no_update BEFORE UPDATE OR DELETE ON lead_events
  FOR EACH ROW EXECUTE FUNCTION app.lead_events_immutable();
--> statement-breakpoint
CREATE TRIGGER lead_events_no_truncate BEFORE TRUNCATE ON lead_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.lead_events_immutable();
--> statement-breakpoint

-- =====================================================================
-- Grants for the runtime role (must be NOBYPASSRLS, not superuser).
-- =====================================================================
GRANT USAGE ON SCHEMA public, app TO luxel_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO luxel_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO luxel_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO luxel_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON lead_events FROM luxel_app;
--> statement-breakpoint
-- Leads are never deleted (archive instead) so record IDs and history survive.
REVOKE DELETE, TRUNCATE ON leads FROM luxel_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON intake_submissions FROM luxel_app;
--> statement-breakpoint

-- =====================================================================
-- Row-level security
-- =====================================================================
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY orgs_self ON orgs FOR SELECT USING (id = app.org_id());
--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_read ON users FOR SELECT USING (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY users_write ON users FOR ALL USING (org_id = app.org_id() AND app.is_owner()) WITH CHECK (org_id = app.org_id() AND app.is_owner());
--> statement-breakpoint

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY settings_read ON org_settings FOR SELECT USING (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY settings_write ON org_settings FOR ALL USING (org_id = app.org_id() AND app.is_owner()) WITH CHECK (org_id = app.org_id() AND app.is_owner());
--> statement-breakpoint

ALTER TABLE assignment_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rules_read ON assignment_rules FOR SELECT USING (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY rules_write ON assignment_rules FOR ALL USING (org_id = app.org_id() AND app.is_owner()) WITH CHECK (org_id = app.org_id() AND app.is_owner());
--> statement-breakpoint

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaigns_read ON campaigns FOR SELECT USING (org_id = app.org_id());
--> statement-breakpoint
-- anyone may insert (auto-created from utm_campaign on intake/import); edits are owner/manager
CREATE POLICY campaigns_insert ON campaigns FOR INSERT WITH CHECK (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY campaigns_update ON campaigns FOR UPDATE USING (org_id = app.org_id() AND app.sees_all_leads());
--> statement-breakpoint
CREATE POLICY campaigns_delete ON campaigns FOR DELETE USING (org_id = app.org_id() AND app.is_owner());
--> statement-breakpoint

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY imports_all ON import_batches FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

-- Leads: owner/manager/system see everything; staff see their own + unassigned.
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leads_read ON leads FOR SELECT
  USING (org_id = app.org_id() AND (app.sees_all_leads() OR owner_id = app.user_id() OR owner_id IS NULL));
--> statement-breakpoint
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (org_id = app.org_id());
--> statement-breakpoint
CREATE POLICY leads_update ON leads FOR UPDATE
  USING (org_id = app.org_id() AND (app.sees_all_leads() OR owner_id = app.user_id() OR owner_id IS NULL))
  WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

-- Child tables inherit lead visibility (the subquery is itself subject to leads RLS).
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lead_events_read ON lead_events FOR SELECT
  USING (org_id = app.org_id() AND EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_events.lead_id));
--> statement-breakpoint
CREATE POLICY lead_events_insert ON lead_events FOR INSERT WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY follow_ups_all ON follow_ups FOR ALL
  USING (org_id = app.org_id() AND EXISTS (SELECT 1 FROM leads l WHERE l.id = follow_ups.lead_id))
  WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

ALTER TABLE duplicate_candidates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dups_all ON duplicate_candidates FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY intake_all ON intake_submissions FOR ALL USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_all ON notifications FOR ALL
  USING (org_id = app.org_id() AND (user_id = app.user_id() OR app.role() = 'system'))
  WITH CHECK (org_id = app.org_id());
--> statement-breakpoint

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY saved_views_own ON saved_views FOR ALL
  USING (org_id = app.org_id() AND user_id = app.user_id()) WITH CHECK (org_id = app.org_id() AND user_id = app.user_id());
--> statement-breakpoint

-- Fuzzy name similarity used by duplicate detection.
CREATE OR REPLACE FUNCTION app.full_name(first text, last text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT lower(trim(coalesce(first, '') || ' ' || coalesce(last, ''))) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.full_name(text, text) TO luxel_app;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_duplicate_of_fk FOREIGN KEY (duplicate_of_id) REFERENCES leads(id);
--> statement-breakpoint
CREATE INDEX leads_duplicate_of_idx ON leads (duplicate_of_id);
