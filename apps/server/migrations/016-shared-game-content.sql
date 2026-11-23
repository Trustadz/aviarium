ALTER TABLE sudoku_packs RENAME TO packs;
ALTER TABLE sudoku_pack_revisions RENAME TO pack_revisions;
ALTER TABLE packs ADD COLUMN game_id text NOT NULL DEFAULT 'sudoku';
CREATE INDEX packs_game ON packs (game_id);

ALTER TABLE published_levels
  ADD COLUMN game_id text NOT NULL DEFAULT 'sudoku',
  ADD COLUMN content jsonb,
  ALTER COLUMN grid DROP NOT NULL,
  ALTER COLUMN difficulty DROP NOT NULL;
ALTER TABLE published_levels DROP CONSTRAINT published_levels_difficulty_check;
ALTER TABLE published_levels ADD CHECK (grid IS NOT NULL OR content IS NOT NULL);
ALTER TABLE published_levels ADD CHECK (
  game_id <> 'sudoku' OR
  (grid IS NOT NULL AND difficulty IS NOT NULL AND difficulty IN ('Easy','Medium','Hard','Extreme','Genius'))
);
