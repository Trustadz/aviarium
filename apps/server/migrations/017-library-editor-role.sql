ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'editor', 'admin'));

UPDATE users
SET role = 'editor'
WHERE role = 'user' AND EXISTS (
  SELECT 1 FROM game_editors WHERE user_id = users.id
);
