CREATE TABLE game_editors (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

INSERT INTO game_editors (user_id, game_id)
SELECT id, 'sudoku' FROM users WHERE role = 'creator';

ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role = 'user' WHERE role IN ('player', 'creator');
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
