CREATE TABLE hidden_levels (
  level_id text PRIMARY KEY,
  hidden_by uuid NOT NULL REFERENCES users(id),
  hidden_at timestamptz NOT NULL DEFAULT now()
);
