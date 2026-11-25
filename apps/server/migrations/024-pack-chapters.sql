-- Packs become a list of chapters. Every existing pack keeps its current
-- behaviour as one chapter, and its levels keep the identities and revisions
-- that saved attempts and completions refer to.
WITH converted AS (
  SELECT p.id AS pack_id, r.revision, jsonb_build_object(
    'format',2,
    'game',COALESCE(r.data->>'game',p.game_id),
    'title',COALESCE(r.data->>'title','Untitled pack'),
    'description',COALESCE(r.data->>'description',''),
    'cover',r.data->'cover',
    'chapters',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id','chapter-1',
      'title',COALESCE(r.data->>'title','Untitled pack'),
      'description',COALESCE(r.data->>'description',''),
      'theme',COALESCE(r.data->>'theme','default'),
      'rules',COALESCE(r.data->'rules','{"inOrder":true}'::jsonb),
      'cover',r.data->'cover',
      'background',r.data->'background',
      'puzzles',COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls((puzzle - 'chapter') ||
          jsonb_build_object('levelId',COALESCE(puzzle->>'levelId','pack:'||p.id||':'||ordinal))) ORDER BY ordinal)
        FROM jsonb_array_elements(r.data->'puzzles') WITH ORDINALITY AS items(puzzle,ordinal)
      ),'[]'::jsonb)
    )))
  ) AS data
  FROM pack_revisions r JOIN packs p ON p.id=r.pack_id
  WHERE r.data->>'format' = '1'
)
UPDATE pack_revisions r SET data=c.data
FROM converted c WHERE r.pack_id=c.pack_id AND r.revision=c.revision;

WITH converted AS (
  SELECT p.id AS pack_id, jsonb_build_object(
    'format',2,
    'game',COALESCE(p.draft->>'game',p.game_id),
    'title',COALESCE(p.draft->>'title','Untitled pack'),
    'description',COALESCE(p.draft->>'description',''),
    'cover',p.draft->'cover',
    'chapters',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id','chapter-1',
      'title',COALESCE(p.draft->>'title','Untitled pack'),
      'description',COALESCE(p.draft->>'description',''),
      'theme',COALESCE(p.draft->>'theme','default'),
      'rules',COALESCE(p.draft->'rules','{"inOrder":true}'::jsonb),
      'cover',p.draft->'cover',
      'background',p.draft->'background',
      'puzzles',COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls((puzzle - 'chapter') ||
          jsonb_build_object('levelId',COALESCE(puzzle->>'levelId','pack:'||p.id||':'||ordinal))) ORDER BY ordinal)
        FROM jsonb_array_elements(p.draft->'puzzles') WITH ORDINALITY AS items(puzzle,ordinal)
      ),'[]'::jsonb)
    )))
  ) AS data
  FROM packs p
  WHERE p.draft->>'format' = '1' AND p.draft ? 'puzzles'
)
UPDATE packs p SET draft=c.data FROM converted c WHERE p.id=c.pack_id;

UPDATE published_levels
SET pack = pack || jsonb_build_object('chapter',COALESCE(pack->>'chapter','chapter-1'))
WHERE pack IS NOT NULL AND pack->>'chapter' IS NULL;
