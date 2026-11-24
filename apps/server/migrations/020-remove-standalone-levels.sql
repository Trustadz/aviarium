-- The pre-pack Sudoku starter levels are retired. Every level now ships inside
-- a pack, so remove these built-in revisions and the user data that referred to
-- them. This is an intentional exception to keeping published revisions: the
-- owner asked for the abandoned levels and their history to disappear.
CREATE TEMP TABLE retired_sudoku_levels (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retired_sudoku_levels(id) VALUES ('first-light'), ('quiet-current'), ('afterglow');

-- Standings and their moderation notices go first because leaderboard_removals
-- cascades from leaderboard_results.
DELETE FROM leaderboard_results r USING retired_sudoku_levels l WHERE r.level_id = l.id;
DELETE FROM completions c USING retired_sudoku_levels l WHERE c.level_id = l.id;
DELETE FROM sync_receipts s USING retired_sudoku_levels l WHERE s.result->'data'->>'level' = l.id;

-- Keep the self-reference on saves valid while removing the saves themselves.
UPDATE saves SET parent_id = NULL
WHERE parent_id IN (SELECT id FROM saves WHERE data->>'level' IN (SELECT id FROM retired_sudoku_levels));
DELETE FROM saves WHERE data->>'level' IN (SELECT id FROM retired_sudoku_levels);

DELETE FROM hidden_levels h USING retired_sudoku_levels l WHERE h.level_id = l.id;
DELETE FROM published_levels p USING retired_sudoku_levels l WHERE p.id = l.id;
