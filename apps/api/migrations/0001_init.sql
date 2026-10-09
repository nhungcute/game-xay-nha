-- Accounts are invisible to players; characters (one per map) live in worlds.
CREATE TABLE accounts (
  id                   uuid PRIMARY KEY,
  token_hash           bytea NOT NULL UNIQUE,
  recovery_hash        text  NOT NULL,
  recovery_prefix_hash bytea NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_recovery_prefix ON accounts (recovery_prefix_hash);

-- One row per character = per world. The full sim snapshot is stored as JSONB and is always
-- re-validated with validateSnapshot when read (docs/08 §6.1); hot fields are copied to columns.
CREATE TABLE worlds (
  id               uuid PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  map_id           text NOT NULL,
  map_kind         text NOT NULL CHECK (map_kind IN ('city', 'farm')),
  template_version integer NOT NULL,
  display_name     text NOT NULL,
  tag              char(4) NOT NULL,
  level            integer NOT NULL,
  net_worth        bigint NOT NULL,
  revision         bigint NOT NULL,
  snapshot         jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, map_kind),
  UNIQUE (display_name, tag)
);
CREATE INDEX worlds_leaderboard ON worlds (map_kind, net_worth DESC);

-- Idempotency + audit (docs/08 §5): every processed command, accepted or rejected.
CREATE TABLE world_commands (
  command_id     uuid PRIMARY KEY,
  world_id       uuid NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  accepted       boolean NOT NULL,
  revision_after bigint NOT NULL,
  result         jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX world_commands_world ON world_commands (world_id, created_at);
