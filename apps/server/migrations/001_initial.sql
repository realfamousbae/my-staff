CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'collector' CHECK (role IN ('collector','editor')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE products (
  id uuid PRIMARY KEY, category text NOT NULL CHECK (category IN ('energy','pringles')),
  brand text NOT NULL, line text, flavor text, title text NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE editions (
  id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), category text NOT NULL CHECK (category IN ('energy','pringles')),
  title text NOT NULL, brand text NOT NULL, line text, flavor text, market text, manufactured_in text, quantity text, design text, series text, barcodes jsonb NOT NULL DEFAULT '[]', evidence text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','merged','archived')),
  merged_into_id uuid REFERENCES editions(id), version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), confirmed_by uuid REFERENCES users(id), confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX editions_search_idx ON editions USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(flavor,'')));
CREATE TABLE edition_revisions (id uuid PRIMARY KEY, edition_id uuid NOT NULL REFERENCES editions(id), author_id uuid REFERENCES users(id), operation text NOT NULL, before_data jsonb, after_data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE capture_sessions (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), title text, created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
CREATE TABLE collection_items (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), category text NOT NULL CHECK(category IN ('energy','pringles')),
  edition_id uuid REFERENCES editions(id), capture_session_id uuid REFERENCES capture_sessions(id), title text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', captured_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1, input_revision integer NOT NULL DEFAULT 0, recognition_status text NOT NULL DEFAULT 'unassigned' CHECK(recognition_status IN ('unassigned','pending','processing','proposed','confirmed','needs_review','failed','outcome_unknown')),
  presentation_status text NOT NULL DEFAULT 'pending' CHECK(presentation_status IN ('pending','processing','ready','failed','outcome_unknown')),
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collection_items_owner_active_idx ON collection_items(owner_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE item_revisions (id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES collection_items(id), author_id uuid NOT NULL REFERENCES users(id), operation_id uuid NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id, operation_id));
CREATE TABLE media_assets (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), item_id uuid NOT NULL REFERENCES collection_items(id), role text NOT NULL CHECK(role IN ('original','detail','artwork','thumbnail')),
  mime_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size > 0), sha256 text NOT NULL, object_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending_upload' CHECK(state IN ('pending_upload','confirmed','rejected')),
  immutable_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, UNIQUE(item_id, sha256, role)
);
CREATE TABLE operation_keys (owner_id uuid NOT NULL REFERENCES users(id), operation_id uuid NOT NULL, kind text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id, operation_id, kind));
CREATE TABLE recognition_attempts (id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES collection_items(id), input_version integer NOT NULL, status text NOT NULL, provider text NOT NULL, result jsonb, started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id,input_version,provider));
CREATE TABLE recognition_candidates (id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES recognition_attempts(id) ON DELETE CASCADE, edition_id uuid REFERENCES editions(id), confidence numeric, evidence jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE artwork_revisions (id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES collection_items(id), input_version integer NOT NULL, media_id uuid REFERENCES media_assets(id), provider text NOT NULL, status text NOT NULL, settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(item_id,input_version,provider));
CREATE TABLE processing_outbox (id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('process_item')), payload jsonb NOT NULL, dedupe_key text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatched','done','failed','outcome_unknown')), attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, finished_at timestamptz, last_error text);
