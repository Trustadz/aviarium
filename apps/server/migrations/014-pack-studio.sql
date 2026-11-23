ALTER TABLE sudoku_packs ADD COLUMN last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Existing standalone publications keep their level keys and all old save references.
CREATE TEMP TABLE recovered_sudoku_levels ON COMMIT DROP AS
WITH latest AS (
  SELECT DISTINCT ON (l.id) l.*
  FROM published_levels l
  ORDER BY l.id,l.revision DESC
), candidates AS (
  SELECT latest.*, EXISTS (SELECT 1 FROM hidden_levels h WHERE h.level_id=latest.id) AS hidden
  FROM latest WHERE author_id IS NOT NULL AND pack IS NULL AND catalog_visible
)
SELECT id,revision,title,grid,difficulty,seed,generator_version,author_id,hidden,
  (row_number() OVER (PARTITION BY author_id,hidden ORDER BY published_at,id) - 1) / 30 AS batch,
  (row_number() OVER (PARTITION BY author_id,hidden ORDER BY published_at,id) - 1) % 30 + 1 AS stop
FROM candidates;

CREATE TEMP TABLE recovered_sudoku_packs ON COMMIT DROP AS
SELECT gen_random_uuid()::text AS id, author_id, batch, hidden, jsonb_build_object(
  'format',1,'game','sudoku',
  'title',CASE WHEN hidden THEN 'Recovered hidden Sudoku puzzles' ELSE 'Recovered Sudoku puzzles' END
    || CASE WHEN batch > 0 THEN ' ' || (batch + 1)::text ELSE '' END,
  'description','','theme','default',
  'rules',jsonb_build_object('hints',true,'autoNotes',true,'inOrder',false,'lives',NULL,'timeTrial',false),
  'puzzles',jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'title',title,'grid',grid,'ruleset',1,'difficulty',difficulty,'levelId',id,'levelRevision',revision,
    'seed',seed,'generatorVersion',generator_version
  )) ORDER BY stop)
) AS data
FROM recovered_sudoku_levels GROUP BY author_id,batch,hidden;

INSERT INTO sudoku_packs(id,owner_id,draft,published_revision,last_edited_by,visible)
SELECT id,author_id,data,1,author_id,NOT hidden FROM recovered_sudoku_packs;
INSERT INTO sudoku_pack_revisions(pack_id,revision,data)
SELECT id,1,data FROM recovered_sudoku_packs;

UPDATE published_levels l SET pack=jsonb_build_object('id',p.id,'revision',1,'stop',r.stop,'legacyStandalone',true)
FROM recovered_sudoku_levels r JOIN recovered_sudoku_packs p USING (author_id,batch,hidden)
WHERE l.id=r.id;

CREATE INDEX published_levels_pack_id ON published_levels ((pack->>'id')) WHERE pack IS NOT NULL;
