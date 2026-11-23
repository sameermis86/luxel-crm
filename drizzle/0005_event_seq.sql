ALTER TABLE "lead_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE lead_events_seq_seq TO luxel_app;
--> statement-breakpoint
CREATE INDEX lead_events_lead_seq_idx ON lead_events (lead_id, at DESC, seq DESC);
