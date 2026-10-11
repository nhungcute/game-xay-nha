-- D027: players log in with a unique username + numeric PIN; the one-time recovery code flow is removed.
-- Sessions move to their own table so one account can be signed in on several devices.
ALTER TABLE accounts ADD COLUMN username      text;
ALTER TABLE accounts ADD COLUMN username_key  text;
ALTER TABLE accounts ADD COLUMN pin_hash      text;
ALTER TABLE accounts ADD COLUMN failed_logins integer NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN locked_until  timestamptz;
ALTER TABLE accounts ALTER COLUMN token_hash           DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN recovery_hash        DROP NOT NULL;
ALTER TABLE accounts ALTER COLUMN recovery_prefix_hash DROP NOT NULL;
CREATE UNIQUE INDEX accounts_username_key ON accounts (username_key) WHERE username_key IS NOT NULL;

CREATE TABLE sessions (
  token_hash   bytea PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account ON sessions (account_id);
-- Existing device logins keep working (accounts created before D027 have no username/PIN yet).
INSERT INTO sessions (token_hash, account_id) SELECT token_hash, id FROM accounts WHERE token_hash IS NOT NULL;
