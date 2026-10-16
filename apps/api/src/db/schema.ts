import { bigint, boolean, customType, integer, jsonb, pgTable, text, timestamp, uuid, char } from 'drizzle-orm/pg-core';
import type { MapKind } from '@xay-nha/contracts';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  /** Legacy single-token column (pre-D027); live sessions are in `sessions`. */
  tokenHash: bytea('token_hash'),
  recoveryHash: text('recovery_hash'),
  recoveryPrefixHash: bytea('recovery_prefix_hash'),
  username: text('username'),
  usernameKey: text('username_key'),
  pinHash: text('pin_hash'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  tokenHash: bytea('token_hash').primaryKey(),
  accountId: uuid('account_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  mapId: text('map_id').notNull(),
  mapKind: text('map_kind').$type<MapKind>().notNull(),
  templateVersion: integer('template_version').notNull(),
  displayName: text('display_name').notNull(),
  tag: char('tag', { length: 4 }).notNull(),
  level: integer('level').notNull(),
  netWorth: bigint('net_worth', { mode: 'number' }).notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** D039: per-world generated template (random maps only). */
export const worldTemplates = pgTable('world_templates', {
  worldId: uuid('world_id').primaryKey(),
  mapId: text('map_id').notNull(),
  generatorVersion: text('generator_version').notNull(),
  seed: bigint('seed', { mode: 'number' }).notNull(),
  attempt: integer('attempt').notNull(),
  template: jsonb('template').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const worldCommands =pgTable('world_commands', {
  commandId: uuid('command_id').primaryKey(),
  worldId: uuid('world_id').notNull(),
  accepted: boolean('accepted').notNull(),
  revisionAfter: bigint('revision_after', { mode: 'number' }).notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
