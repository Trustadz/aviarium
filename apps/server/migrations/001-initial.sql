CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','creator','admin')),
  UNIQUE (issuer, subject)
);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE login_attempts (
  token_hash text PRIMARY KEY,
  verifier text NOT NULL,
  state text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  grid text NOT NULL CHECK (grid ~ '^[0-9]{81}$'),
  version integer NOT NULL DEFAULT 1,
  seed text,
  generator_version integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE published_levels (
  id text NOT NULL,
  revision integer NOT NULL,
  ruleset integer NOT NULL,
  title text NOT NULL,
  grid text NOT NULL CHECK (grid ~ '^[0-9]{81}$'),
  difficulty text NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  source text NOT NULL CHECK (source IN ('Built-in','Generated','Creator')),
  author_id uuid REFERENCES users(id),
  seed text,
  generator_version integer,
  validation text NOT NULL CHECK (validation IN ('unique','multiple')),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, revision)
);
CREATE TABLE puzzle_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  draft_id uuid REFERENCES drafts(id),
  draft_version integer,
  kind text NOT NULL CHECK (kind IN ('validate','generate')),
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','failed')),
  result jsonb,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX puzzle_jobs_ready ON puzzle_jobs (created_at) WHERE status IN ('queued','running');
CREATE TABLE saves (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1,
  data jsonb NOT NULL,
  parent_id uuid REFERENCES saves(id),
  archived boolean NOT NULL DEFAULT false
);
CREATE INDEX saves_owner ON saves (owner_id);
CREATE TABLE completions (
  owner_id uuid NOT NULL REFERENCES users(id),
  level_id text NOT NULL,
  level_revision integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, level_id, level_revision),
  FOREIGN KEY (level_id, level_revision) REFERENCES published_levels(id, revision)
);
CREATE TABLE sync_receipts (
  owner_id uuid NOT NULL REFERENCES users(id),
  id uuid NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE preferences (
  owner_id uuid PRIMARY KEY REFERENCES users(id),
  revision integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE backup_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  folder text NOT NULL DEFAULT '',
  schedule text NOT NULL DEFAULT '0 3 * * *',
  retention integer NOT NULL DEFAULT 3 CHECK (retention BETWEEN 1 AND 100),
  requested_at timestamptz,
  last_attempt timestamptz,
  schedule_since timestamptz NOT NULL DEFAULT now(),
  last_success timestamptz,
  error text,
  archives jsonb NOT NULL DEFAULT '[]'::jsonb
);
INSERT INTO backup_config DEFAULT VALUES;
