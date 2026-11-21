WITH posts AS (
  INSERT INTO news_posts (category, published_at, is_test)
  SELECT 'update', TIMESTAMPTZ '2026-11-21 10:06:39+00', modes.is_test
  FROM (VALUES (false), (true)) AS modes(is_test)
  RETURNING id
)
INSERT INTO news_translations (post_id, locale, title, intro, body, header_alt)
SELECT posts.id, copy.locale, copy.title, copy.intro, copy.body, ''
FROM posts CROSS JOIN (VALUES
  ('en', 'What’s new in Aviarium 0.1.15',
   'Aviarium is now available in English and Dutch. Choose your language in Account settings from the library.',
   'Open How to play from the Sudoku menu for the rules, an example first move, and tips on using notes and hints. News announcements can now be published in both languages.'),
  ('nl', 'Nieuw in Aviarium 0.1.15',
   'Aviarium is nu beschikbaar in het Engels en Nederlands. Kies je taal bij Accountinstellingen in de bibliotheek.',
   'Open Speluitleg in het Sudokumenu voor de regels, een voorbeeld van een eerste zet en tips over notities en hints. Aankondigingen kunnen nu in beide talen worden gepubliceerd.')
) AS copy(locale, title, intro, body);
