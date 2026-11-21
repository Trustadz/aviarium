INSERT INTO news_posts (category, title, intro, body, published_at, is_test)
SELECT 'update', 'What’s new in Aviarium 0.1.13',
       'Aviarium has a new Library, Studio, and News layout, with easier access to your account and device settings.',
       'On phones, use the bottom bar to move between the main screens. On larger screens, use the sidebar.

Studio gives creators a game picker and a dedicated Sudoku workspace for puzzles and packs in both light and dark themes.

Visit News for announcements and illustrated updates. Open your account menu to change your display name or avatar, or to find device settings.',
       TIMESTAMPTZ '2026-11-21 09:06:24+00', modes.is_test
FROM (VALUES (false), (true)) AS modes(is_test);
