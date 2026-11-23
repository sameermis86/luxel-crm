-- Extensions + the human record-id sequence (must exist before `leads`).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- NO CYCLE + never reset: sequence values are never handed out twice, even if a
-- transaction rolls back or a lead is merged/archived. Record IDs are never reused.
CREATE SEQUENCE IF NOT EXISTS lead_record_seq START 1 NO CYCLE;
