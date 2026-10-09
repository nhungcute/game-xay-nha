import { bigint, boolean, customType, integer, jsonb, pgTable, text, timestamp, uuid, char } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  tokenHash: bytea('token_hash').notNull(),
  recoveryHash: text('recovery_hash').notNull(),
  recoveryPrefixHash: bytea('recovery_prefix_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  mapId: text('map_id').notNull(),
  mapKind: text('map_kind').$type<'city' | 'farm'>().notNull(),
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

export const worldCommands = pgTable('world_commands', {
  commandId: uuid('command_id').primaryKey(),
  worldId: uuid('world_id').notNull(),
  accepted: boolean('accepted').notNull(),
  revisionAfter: bigint('revision_after', { mode: 'number' }).notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
