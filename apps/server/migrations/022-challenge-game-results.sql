-- A completed challenge now posts two rows for the same save: the closed daily
-- leaderboard and the normal game leaderboard with the challenge's difficulty,
-- size and rules. Keep one result per save and board instead of one per save.
ALTER TABLE leaderboard_results DROP CONSTRAINT IF EXISTS leaderboard_results_save_id_key;
ALTER TABLE leaderboard_results ADD CONSTRAINT leaderboard_results_save_id_board_key UNIQUE (save_id, board_key);
