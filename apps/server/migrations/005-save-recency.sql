ALTER TABLE saves ADD COLUMN updated_at timestamptz;

-- Older saves have no play timestamp. Use revision and ID for a stable initial order.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY owner_id ORDER BY revision DESC, id DESC) AS position
  FROM saves
  WHERE NOT archived AND data->>'completed' = 'false'
)
UPDATE saves SET archived = true, revision = revision + 1
FROM ranked WHERE saves.id = ranked.id AND ranked.position > 5;

CREATE INDEX saves_continue_order ON saves (owner_id, updated_at DESC NULLS LAST, revision DESC, id DESC)
WHERE NOT archived AND data->>'completed' = 'false';
