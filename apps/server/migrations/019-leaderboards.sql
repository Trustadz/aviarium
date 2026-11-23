-- Leaderboards keep one row per completed attempt. The board groups results by
-- the game's settings (Sudoku difficulty, Nonograms size and difficulty, or a
-- published level revision). The exact starting puzzle is stored separately so
-- the 30-day cooldown is scoped to that puzzle, not to the whole board.
CREATE TABLE leaderboard_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  save_id uuid NOT NULL UNIQUE REFERENCES saves(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  game_id text NOT NULL,
  board_key text NOT NULL,
  board_kind text NOT NULL CHECK (board_kind IN ('quick','level')),
  board_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  level_id text NOT NULL,
  level_revision integer NOT NULL,
  pack_id text,
  pack_revision integer,
  pack_stop integer,
  level_title text NOT NULL,
  pack_title text,
  seed_code text,
  puzzle_key text NOT NULL,
  score_value bigint NOT NULL CHECK (score_value >= 0),
  value_unit text NOT NULL DEFAULT 'ms',
  lower_is_better boolean NOT NULL DEFAULT true,
  rank_value bigint GENERATED ALWAYS AS (CASE WHEN lower_is_better THEN score_value ELSE -score_value END) STORED,
  aids jsonb,
  rules_version integer NOT NULL,
  completed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cooldown','removed')),
  FOREIGN KEY (level_id, level_revision) REFERENCES published_levels(id, revision)
);
CREATE INDEX leaderboard_results_board ON leaderboard_results
  (game_id, board_key, status, rank_value, completed_at, id);
CREATE INDEX leaderboard_results_cooldown ON leaderboard_results
  (owner_id, game_id, puzzle_key, recorded_at DESC);
CREATE INDEX leaderboard_results_owner ON leaderboard_results (owner_id, recorded_at DESC);

-- Private moderation record. The public standings only read active results.
CREATE TABLE leaderboard_removals (
  result_id uuid PRIMARY KEY REFERENCES leaderboard_results(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  removed_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX leaderboard_removals_pending ON leaderboard_removals (removed_at)
  WHERE acknowledged_at IS NULL;
