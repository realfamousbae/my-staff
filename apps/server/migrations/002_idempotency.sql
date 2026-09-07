ALTER TABLE operation_keys ADD COLUMN IF NOT EXISTS payload_hash text;
UPDATE operation_keys SET payload_hash = '' WHERE payload_hash IS NULL;
ALTER TABLE operation_keys ALTER COLUMN payload_hash SET NOT NULL;
CREATE INDEX IF NOT EXISTS operation_keys_owner_created_idx ON operation_keys(owner_id, created_at);
