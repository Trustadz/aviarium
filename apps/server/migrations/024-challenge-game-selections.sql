-- The daily draft is now a list of game selections. A game may appear more than
-- once with different option sets, but a day still uses each game at most once.
-- Keep the older eligible_games/game_options columns for compatibility and
-- backfill one selection per configured game.
ALTER TABLE challenge_series
  ADD COLUMN IF NOT EXISTS game_selections jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE challenge_series s
SET game_selections = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('game', g,
      'options', COALESCE(s.game_options -> g, '{}'::jsonb)) ORDER BY ord)
  FROM unnest(COALESCE(s.eligible_games, ARRAY(SELECT jsonb_object_keys(s.game_options))))
    WITH ORDINALITY AS t(g, ord)
), '[]'::jsonb),
  updated_at = now()
WHERE s.id = 'daily' AND jsonb_array_length(s.game_selections) = 0;
