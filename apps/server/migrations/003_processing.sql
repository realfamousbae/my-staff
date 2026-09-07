ALTER TABLE processing_outbox DROP CONSTRAINT processing_outbox_state_check;
ALTER TABLE processing_outbox ADD CONSTRAINT processing_outbox_state_check CHECK (state IN ('pending','dispatched','running','done','failed','outcome_unknown'));
ALTER TABLE processing_outbox ADD COLUMN lease_until timestamptz;
ALTER TABLE processing_outbox ADD COLUMN worker_token uuid;
CREATE TABLE provider_calls (
  request_key text PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES collection_items(id),
  input_revision integer NOT NULL,
  stage text NOT NULL CHECK (stage IN ('recognition','artwork')),
  provider text NOT NULL,
  state text NOT NULL CHECK (state IN ('started','succeeded','outcome_unknown')),
  result jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX provider_calls_daily_idx ON provider_calls(started_at);
