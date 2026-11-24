-- Daily challenges are orchestration: a series schedules occurrences, an
-- occurrence has one slot per game, a player claims one attempt per slot, and
-- a completed attempt posts one challenge result. Results reuse
-- leaderboard_results so standings, avatars and moderation stay in one place.
--
-- Challenge levels are real published_levels rows with source='Challenge' and
-- catalog_visible=false. The challenge board is platform-owned; the game only
-- supplies generation, validation and result interpretation.

CREATE TABLE challenge_series (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('daily','weekly','monthly','seasonal','one_time')),
  enabled boolean NOT NULL DEFAULT false,
  game_limit smallint NOT NULL DEFAULT 1 CHECK (game_limit BETWEEN 1 AND 50),
  -- NULL means every registered challenge-capable game; '{}' means none.
  eligible_games text[],
  -- Map of game id -> option-group key -> enabled choice ids. Puzzle settings
  -- for now; pack-rule groups can join the same shape later.
  game_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone text NOT NULL DEFAULT 'UTC',
  reset_minute smallint NOT NULL DEFAULT 0 CHECK (reset_minute BETWEEN 0 AND 1439),
  generation_version integer NOT NULL DEFAULT 1,
  label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO challenge_series(id, kind, enabled, game_limit, eligible_games, game_options, timezone, reset_minute)
VALUES ('daily', 'daily', false, 1, NULL,
  '{"sudoku":{"difficulty":["Easy","Medium","Hard"]},"nonograms":{"size":[10],"difficulty":["Easy","Medium","Hard"]}}'::jsonb,
  'UTC', 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE challenge_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id text NOT NULL REFERENCES challenge_series(id) ON DELETE RESTRICT,
  -- Local date of the start boundary, e.g. 2026-11-25.
  period_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Snapshot: changing the series timezone/reset later must not relabel history.
  timezone text NOT NULL,
  reset_minute smallint NOT NULL CHECK (reset_minute BETWEEN 0 AND 1439),
  generation_version integer NOT NULL,
  -- Snapshot of game_limit/eligible_games/game_options at creation so a later
  -- admin change cannot reshuffle a day that is already prepared.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Random occurrence seed; slot/level seeds are derived from it and persisted.
  seed text NOT NULL,
  preparing_at timestamptz,
  prepared_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, period_key),
  CHECK (ends_at > starts_at)
);

CREATE INDEX challenge_occurrences_series_window
  ON challenge_occurrences (series_id, starts_at, ends_at);

CREATE TABLE challenge_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES challenge_occurrences(id) ON DELETE RESTRICT,
  game_id text NOT NULL,
  position smallint NOT NULL CHECK (position >= 0),
  -- The chosen option-group values, choice ids and default rules for this slot.
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  choices jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Slot seed for replay/audit; the level content remains the source of truth.
  seed text,
  level_id text,
  level_revision integer,
  generator_version integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  failure_code text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (occurrence_id, game_id),
  UNIQUE (occurrence_id, position),
  UNIQUE (id, occurrence_id),
  FOREIGN KEY (level_id, level_revision) REFERENCES published_levels(id, revision),
  CHECK ((status = 'ready') = (level_id IS NOT NULL AND level_revision IS NOT NULL AND generator_version IS NOT NULL)),
  CHECK (status <> 'ready' OR seed IS NOT NULL)
);

CREATE INDEX challenge_slots_level ON challenge_slots (level_id, level_revision);

CREATE TABLE challenge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL,
  occurrence_id uuid NOT NULL REFERENCES challenge_occurrences(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The server-issued save id. The client must use this as its local session id
  -- so a second tab/device resumes the same attempt.
  session_id uuid NOT NULL UNIQUE,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed','closed')),
  FOREIGN KEY (slot_id, occurrence_id) REFERENCES challenge_slots(id, occurrence_id),
  UNIQUE (slot_id, owner_id),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CHECK (status <> 'started' OR completed_at IS NULL)
);

CREATE INDEX challenge_attempts_owner ON challenge_attempts (owner_id, occurrence_id);
CREATE INDEX challenge_attempts_slot_status ON challenge_attempts (slot_id, status);

-- Challenge results reuse the leaderboard table. Existing rows remain valid:
-- the new columns are NULL and the old board kinds are unchanged.
ALTER TABLE leaderboard_results DROP CONSTRAINT leaderboard_results_board_kind_check;
ALTER TABLE leaderboard_results ADD CONSTRAINT leaderboard_results_board_kind_check
  CHECK (board_kind IN ('quick','level','challenge'));

ALTER TABLE leaderboard_results
  ADD COLUMN challenge_slot_id uuid REFERENCES challenge_slots(id) ON DELETE RESTRICT,
  ADD COLUMN challenge_attempt_id uuid UNIQUE REFERENCES challenge_attempts(id) ON DELETE RESTRICT;

ALTER TABLE leaderboard_results ADD CONSTRAINT leaderboard_results_challenge_shape CHECK (
  (board_kind = 'challenge' AND challenge_slot_id IS NOT NULL AND challenge_attempt_id IS NOT NULL)
  OR (board_kind <> 'challenge' AND challenge_slot_id IS NULL AND challenge_attempt_id IS NULL)
);
ALTER TABLE leaderboard_results ADD CONSTRAINT leaderboard_results_challenge_active CHECK (
  challenge_slot_id IS NULL OR status <> 'cooldown'
);
CREATE INDEX leaderboard_results_challenge_slot ON leaderboard_results (challenge_slot_id)
  WHERE challenge_slot_id IS NOT NULL;

-- Challenge levels are distinct from Quick Play generated levels. Both games'
-- boardKey() treat 'Generated' as Quick Play; 'Challenge' prevents a challenge
-- level from leaking onto a general board. The optional rules snapshot lets a
-- replay (a normal generated game from the same recipe) apply the same rules.
ALTER TABLE published_levels DROP CONSTRAINT published_levels_source_check;
ALTER TABLE published_levels ADD CONSTRAINT published_levels_source_check
  CHECK (source IN ('Built-in','Generated','Creator','Challenge'));
ALTER TABLE published_levels ADD COLUMN rules jsonb;
