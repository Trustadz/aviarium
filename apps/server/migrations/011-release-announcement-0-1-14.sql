INSERT INTO news_posts (category, title, intro, body, published_at, is_test)
SELECT 'update', 'What’s new in Aviarium 0.1.14',
       'The mobile navigation bar fits the gesture area, and the account menu now has an About page with a link to GitHub.',
       'There is more space below the Continue cards, and the footer has been removed. Look here in News for feature announcements included with future updates.',
       TIMESTAMPTZ '2026-11-21 09:31:25+00', modes.is_test
FROM (VALUES (false), (true)) AS modes(is_test);
