import { z } from 'zod';
import { CellSchema, IdSchema, IntegerSchema, RotationSchema, TimestampSchema } from './schema.js';

export const RectSchema = z.tuple([
  IntegerSchema.max(127), IntegerSchema.max(127), IntegerSchema.max(127), IntegerSchema.max(127),
]).refine(([x0, z0, x1, z1]) => x0 <= x1 && z0 <= z1, 'Rectangle bounds must be ordered')
  .refine(([x0, z0, x1, z1]) => (x1 - x0 + 1) * (z1 - z0 + 1) <= 256, 'Area exceeds 256 cells');

export const CellsSchema = z.array(CellSchema).min(1).max(256)
  .refine(cells => new Set(cells.map(([x, z]) => `${x}:${z}`)).size === cells.length, 'Duplicate cell');
const strings = z.array(IdSchema).min(1).max(256)
  .refine(ids => new Set(ids).size === ids.length, 'Duplicate ID');
const building = IdSchema.regex(/^b_[A-Za-z0-9_-]+$/);
const bridge = IdSchema.regex(/^br_[A-Za-z0-9_-]+$/);
const target = z.union([
  z.object({ buildingId: building }).strict(),
  z.object({ bridgeId: bridge }).strict(),
]);
const cellsPayload = z.object({ cells: CellsSchema }).strict();
const rectPayload = z.object({ rect: RectSchema }).strict();
const height = z.number().int().min(-32768).max(32767).multipleOf(5);
const common = {
  commandId: z.string().uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  worldId: IdSchema,
  expectedRevision: IntegerSchema,
  clientTime: TimestampSchema,
};
function command<T extends string, P extends z.ZodTypeAny>(type: T, payload: P) {
  return z.object({ ...common, type: z.literal(type), payload }).strict();
}

export const CommandSchema = z.discriminatedUnion('type', [
  command('CLEAR_ENV', z.object({ envIds: strings }).strict()),
  command('TERRAFORM', z.object({ rect: RectSchema, mode: z.enum(['RAISE', 'LOWER', 'FLATTEN']), targetHDm: height.optional() }).strict()
    .refine(payload => payload.mode === 'FLATTEN' || payload.targetHDm === undefined, 'Target height is only valid for flatten')),
  command('TILL', rectPayload),
  command('UNTILL', rectPayload),
  command('EMBANK', cellsPayload),
  command('REMOVE_EMBANK', cellsPayload),
  command('BUILD_ROAD', z.object({
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    cells: CellsSchema.refine(cells => cells.every((cell, i) => {
      const previous = cells[i - 1];
      return !previous || Math.abs(cell[0] - previous[0]) + Math.abs(cell[1] - previous[1]) === 1;
    }), 'Road cells must form a consecutive four-direction path'),
  }).strict()),
  command('REMOVE_ROAD', cellsPayload),
  command('BUILD_BRIDGE', z.object({ typeId: z.enum(['bridge_wood', 'bridge_stone', 'bridge_concrete']), a: CellSchema, b: CellSchema }).strict()),
  command('REMOVE_BRIDGE', z.object({ bridgeId: bridge }).strict()),
  command('PLACE_BUILDING', z.object({ defId: IdSchema, anchor: CellSchema, rotation: RotationSchema, autoFlattenHDm: height.optional() }).strict()),
  command('DEMOLISH', z.object({ buildingId: building }).strict()),
  command('CANCEL_CONSTRUCTION', target),
  command('SPEED_UP', target),
  command('COLLECT', z.object({ buildingIds: z.array(building).max(256).refine(ids => new Set(ids).size === ids.length, 'Duplicate building ID') }).strict()),
  command('PLANT', z.object({ rect: RectSchema, cropId: IdSchema }).strict()),
  command('HARVEST', cellsPayload),
  command('START_PRODUCTION', z.object({ buildingId: building, recipeId: IdSchema, count: IntegerSchema.min(1).max(256) }).strict()),
  command('COLLECT_PRODUCTION', z.object({ buildingId: building }).strict()),
  command('SELL', z.object({ items: z.record(IdSchema, IntegerSchema.min(1)).refine(items => Object.keys(items).length > 0 && Object.keys(items).length <= 256, 'Expected 1–256 item kinds') }).strict()),
  command('BUY_MATERIAL', z.object({ wood: IntegerSchema.min(1).optional(), stone: IntegerSchema.min(1).optional() }).strict()
    .refine(payload => payload.wood !== undefined || payload.stone !== undefined, 'At least one material required')),
  command('UNLOCK_ZONE', z.object({ zoneId: IntegerSchema.max(63) }).strict()),
  command('CLAIM_QUEST', z.object({ questId: IdSchema }).strict()),
  command('REROLL_QUEST', z.object({ questId: IdSchema }).strict()),
  command('UPGRADE_BUILDING', z.object({ buildingId: building }).strict()),
  command('CLAIM_RELIEF', z.object({}).strict()),
]);

export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];
export type CommandPayload = { [T in CommandType]: Extract<Command, { type: T }>['payload'] };
export type CommandEnvelope<T extends CommandType = CommandType> = Extract<Command, { type: T }>;
export const commandSchema = CommandSchema;

export const ErrorCodeSchema = z.enum([
  'ZONE_LOCKED', 'PROTECTED', 'INSUFFICIENT_FUNDS', 'LEVEL_REQUIRED', 'AREA_TOO_LARGE',
  'CELL_BLOCKED', 'CELL_TILLED', 'OCCUPIED', 'NOT_FLAT', 'TOO_STEEP', 'TOO_STEEP_EDGE',
  'AFFECTS_NEIGHBOR', 'SHORE_RULE', 'NEAR_WATER_NOT_EMBANKED', 'NOT_SHORE',
  'BRIDGE_NOT_STRAIGHT', 'BRIDGE_END_INVALID', 'BRIDGE_SPAN_NOT_WATER', 'BRIDGE_TOO_LONG',
  'BRIDGE_HEIGHT_MISMATCH', 'BRIDGE_CROSSING', 'FIELD_LIMIT', 'STORAGE_FULL',
  'NO_ROAD_ACCESS', 'WRONG_MAP', 'NO_BUILDER_FREE', 'UNDER_CONSTRUCTION',
  'NOT_UNDER_CONSTRUCTION', 'LIMIT_REACHED', 'REVISION_CONFLICT',
  'INVALID_COMMAND', 'INVALID_SNAPSHOT', 'INVALID_TEMPLATE', 'INVALID_TIME', 'NOT_FOUND',
  'BUILDING_NOT_FOUND', 'INSUFFICIENT_ITEMS', 'QUEST_NOT_READY', 'PRODUCTION_ACTIVE',
  'NOT_UPGRADEABLE', 'RELIEF_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export interface GameEvent {
  type: 'LEVEL_UP' | 'QUEST_COMPLETED' | 'UNLOCK';
  level?: number; questId?: string; unlockIds?: string[];
}

export interface StatePatch {
  wallet?: import('./content.js').Cost;
  progress?: import('./schema.js').Progress;
  character?: import('./schema.js').WorldSnapshot['character'];
  unlockedZones?: number[];
  landValue?: number;
  zones?: Record<number, import('./schema.js').ZoneDelta>;
  buildings?: { upsert: import('./schema.js').PlacedBuilding[]; remove: string[] };
  bridges?: { upsert: import('./schema.js').PlacedBridge[]; remove: string[] };
  crops?: import('./schema.js').PlantedCrop[];
  inventory?: Record<string, number>;
  removedEnvIds?: string[];
}

export type CommandResult =
  | { commandId: string; accepted: true; revision: number; patch: StatePatch; serverTime: number; events?: GameEvent[] }
  | { commandId: string; accepted: false; code: ErrorCode; detail?: unknown; revision: number; serverTime: number };
