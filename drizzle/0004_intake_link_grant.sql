-- the ledger row is immutable except for linking it to the lead it produced
GRANT UPDATE (lead_id) ON intake_submissions TO luxel_app;
