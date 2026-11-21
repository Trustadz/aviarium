ALTER TABLE news_posts ADD COLUMN intro text;
ALTER TABLE news_posts ADD COLUMN header_image text;
ALTER TABLE news_posts ADD COLUMN header_alt text NOT NULL DEFAULT '';
