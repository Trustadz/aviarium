ALTER TABLE users ADD COLUMN display_name text;
ALTER TABLE users ADD COLUMN pocket_avatar text;
ALTER TABLE users ADD COLUMN custom_avatar text;

CREATE TABLE news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('update', 'content', 'game')),
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  is_test boolean NOT NULL
);
CREATE INDEX news_posts_feed ON news_posts (is_test, published_at DESC, id DESC);

CREATE TABLE news_likes (
  post_id uuid NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
