ALTER TABLE published_levels DROP CONSTRAINT published_levels_difficulty_check;
ALTER TABLE published_levels ADD CHECK (difficulty IN ('Easy','Medium','Hard','Extreme','Genius'));
ALTER TABLE published_levels ADD COLUMN catalog_visible boolean NOT NULL DEFAULT true;
ALTER TABLE published_levels ADD COLUMN pack jsonb;

CREATE TABLE sudoku_packs (
  id text PRIMARY KEY,
  owner_id uuid REFERENCES users(id),
  draft jsonb NOT NULL,
  draft_version integer NOT NULL DEFAULT 1,
  published_revision integer,
  visible boolean NOT NULL DEFAULT true
);

CREATE TABLE sudoku_pack_revisions (
  pack_id text NOT NULL REFERENCES sudoku_packs(id),
  revision integer NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (pack_id, revision)
);
