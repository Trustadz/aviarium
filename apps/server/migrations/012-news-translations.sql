ALTER TABLE news_posts ADD COLUMN revision integer NOT NULL DEFAULT 1;

CREATE TABLE news_translations (
  post_id uuid NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('en', 'nl')),
  title text NOT NULL,
  intro text NOT NULL,
  body text NOT NULL,
  header_alt text NOT NULL,
  PRIMARY KEY (post_id, locale)
);

INSERT INTO news_translations (post_id, locale, title, intro, body, header_alt)
SELECT id, 'en', title, coalesce(intro, body), CASE WHEN intro IS NULL THEN '' ELSE body END, header_alt
FROM news_posts;

INSERT INTO news_translations (post_id, locale, title, intro, body, header_alt)
SELECT id, 'nl', 'Nieuw in Aviarium 0.1.13',
       'Aviarium heeft een nieuwe indeling voor Bibliotheek, Studio en Nieuws. Je account- en apparaatinstellingen zijn makkelijker te vinden.',
       'Op telefoons wissel je tussen de hoofdschermen via de balk onderaan. Op grotere schermen gebruik je de zijbalk.

In Studio kunnen makers een spel kiezen en in een eigen Sudoku-werkruimte aan puzzels en pakketten werken, in een licht of donker thema.

Ga naar Nieuws voor aankondigingen en updates met afbeeldingen. Open je accountmenu om je weergavenaam of profielfoto te wijzigen, of om de apparaatinstellingen te openen.',
       ''
FROM news_posts
WHERE category = 'update' AND title = 'What’s new in Aviarium 0.1.13'
  AND published_at = TIMESTAMPTZ '2026-11-21 09:06:24+00';

INSERT INTO news_translations (post_id, locale, title, intro, body, header_alt)
SELECT id, 'nl', 'Nieuw in Aviarium 0.1.14',
       'De navigatiebalk op mobiele apparaten houdt rekening met het gebarengebied. In het accountmenu vind je nu ook een pagina Over Aviarium met een link naar GitHub.',
       'Onder de kaarten voor Verder spelen is meer ruimte en de voettekst is verwijderd. In Nieuws vind je ook bij toekomstige updates aankondigingen over nieuwe functies.',
       ''
FROM news_posts
WHERE category = 'update' AND title = 'What’s new in Aviarium 0.1.14'
  AND published_at = TIMESTAMPTZ '2026-11-21 09:31:25+00';

ALTER TABLE news_posts DROP COLUMN title, DROP COLUMN intro, DROP COLUMN body, DROP COLUMN header_alt;

CREATE TABLE news_translation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_locale text NOT NULL CHECK (source_locale IN ('en', 'nl')),
  source jsonb NOT NULL,
  result jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_translation_jobs_ready ON news_translation_jobs (created_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX news_translation_jobs_user ON news_translation_jobs (user_id, created_at);
