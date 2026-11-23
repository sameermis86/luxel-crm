-- re-import detection: find an earlier import of the exact same row
CREATE INDEX lead_events_import_row_hash_idx ON lead_events ((payload->>'rowHash')) WHERE type = 'imported';
