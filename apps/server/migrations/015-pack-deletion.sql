ALTER TABLE sudoku_packs ADD COLUMN deleted_at timestamptz;

-- Earlier Studio builds stored the correct variant in the pack but used the classic ruleset in the level index.
UPDATE published_levels AS level
SET ruleset = 2
FROM sudoku_pack_revisions AS revision
CROSS JOIN LATERAL jsonb_array_elements(revision.data->'puzzles') WITH ORDINALITY AS puzzle(data, position)
WHERE puzzle.data->>'ruleset' = '2'
  AND level.id = coalesce(puzzle.data->>'levelId', 'pack:' || revision.pack_id || ':' || puzzle.position)
  AND level.revision = coalesce((puzzle.data->>'levelRevision')::integer, revision.revision)
  AND level.ruleset = 1;
