import { z } from 'zod';
import { GRID, VERTS, ZONE_CELLS, ZONES } from './grid.js';

export const IntegerSchema = z.number().int().nonnegative().safe();
export const TimestampSchema = IntegerSchema;
export const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const MapKindSchema = z.enum(['city', 'farm']);
export const CellSchema = z.tuple([IntegerSchema.max(GRID - 1), IntegerSchema.max(GRID - 1)]);
export const RotationSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const CostSchema = z.object({ cash: IntegerSchema, wood: IntegerSchema, stone: IntegerSchema }).strict();
const point = z.tuple([z.number().finite(), z.number().finite()]);
const zoneId = IntegerSchema.max(ZONES * ZONES - 1);
const positive = z.number().finite().positive();
const height = z.number().int().min(-32768).max(32767);
const buildingId = IdSchema.regex(/^b_[A-Za-z0-9_-]+$/);
const bridgeId = IdSchema.regex(/^br_[A-Za-z0-9_-]+$/);

function unique<T>(entries: T[], key: (entry: T) => string): boolean {
  return new Set(entries.map(key)).size === entries.length;
}

export function encodedLayerSchema(byteLength: number) {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  return z.string().length(encodedLength).refine(value => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    if (value.length / 4 * 3 - padding !== byteLength) return false;
    // Reject noncanonical padding bits without relying on Node or browser APIs.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const finalDigit = alphabet.indexOf(value[value.length - padding - 1] ?? '');
    return padding === 0 || (padding === 1 ? finalDigit % 4 === 0 : finalDigit % 16 === 0);
  }, 'Expected canonical base64 with the specified decoded byte length');
}

export const EnvInstanceSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  cell: CellSchema,
  footprint: z.union([z.literal(1), z.literal(2)]),
  offsetXZ: point,
  yawDeg: z.number().finite(),
  scale: positive,
  blocking: z.boolean(),
}).strict();

export const EnvSpecSchema = z.object({
  catalogVersion: IntegerSchema.min(1),
  anchors: z.array(EnvInstanceSchema),
  scatter: z.array(z.object({
    biome: IntegerSchema.max(255),
    category: z.enum(['tree_deciduous', 'tree_conifer', 'rock', 'rock_large', 'bush', 'reed', 'flower']),
    densityPerCell: z.number().finite().min(0).max(1),
    assetIds: z.array(IdSchema).min(1),
    rules: z.object({
      minWaterDistCells: IntegerSchema.optional(),
      maxSlopeDm: IntegerSchema.optional(),
      avoidSuggestedLots: z.boolean().optional(),
      onlyShore: z.boolean().optional(),
    }).strict(),
  }).strict()),
}).strict();

export const WorldTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  mapId: IdSchema,
  mapKind: MapKindSchema,
  templateVersion: IntegerSchema.min(1),
  generatorVersion: z.string().min(1).max(128),
  seed: IntegerSchema.max(0xffffffff),
  waterLevelDm: height,
  grid: z.object({ size: z.literal(128), cellSizeM: z.literal(2) }).strict(),
  layers: z.object({
    heightsDm: encodedLayerSchema(VERTS * VERTS * 2),
    surface: encodedLayerSchema(GRID * GRID),
    flags: encodedLayerSchema(GRID * GRID),
    roadTier: encodedLayerSchema(GRID * GRID),
    biome: encodedLayerSchema(GRID * GRID),
  }).strict(),
  water: z.object({
    lakes: z.array(z.object({ id: IdSchema, polygonXZ: z.array(point).min(3) }).strict()),
    rivers: z.array(z.object({ id: IdSchema, centerlineXZ: z.array(point).min(2), widthM: z.array(positive).min(2) }).strict()
      .refine(river => river.centerlineXZ.length === river.widthM.length, 'River points and widths must match')),
    waterfalls: z.array(z.object({ id: IdSchema, topXZ: point, bottomXZ: point, widthM: positive }).strict()),
  }).strict(),
  startZones: z.array(zoneId).min(1).max(64).refine(values => unique(values, String), 'Duplicate start zone'),
  entryCells: z.array(CellSchema).min(1).max(3).refine(values => unique(values, String), 'Duplicate entry cell'),
  env: EnvSpecSchema,
  suggestedLots: z.array(z.object({ id: IdSchema, cells: z.tuple([IntegerSchema.max(127), IntegerSchema.max(127), IntegerSchema.max(127), IntegerSchema.max(127)]) }).strict()).optional(),
  bankRegions: z.array(z.object({ id: IdSchema, cells: z.array(CellSchema).min(1) }).strict()).min(1).optional(),
  camera: z.object({ target: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]), yawDeg: z.number().finite(), pitchDeg: z.number().finite(), distance: positive }).strict(),
  palette: z.record(IdSchema, z.string().max(128)),
}).strict();

export const ZoneDeltaSchema = z.object({
  heightsDm: encodedLayerSchema((ZONE_CELLS + 1) ** 2 * 2),
  surface: encodedLayerSchema(ZONE_CELLS ** 2),
  flags: encodedLayerSchema(ZONE_CELLS ** 2),
  roadTier: encodedLayerSchema(ZONE_CELLS ** 2),
}).strict();

export const WorldDeltaSchema = z.object({
  zones: z.record(z.string().regex(/^(?:[0-9]|[1-5][0-9]|6[0-3])$/), ZoneDeltaSchema),
  removedEnvIds: z.array(IdSchema).max(GRID * GRID).refine(values => unique(values, String), 'Duplicate removed environment ID'),
}).strict();

export const ProductionJobSchema = z.object({ recipeId: IdSchema, startedAt: TimestampSchema, readyAt: TimestampSchema }).strict();
export const PlacedBuildingSchema = z.object({
  id: buildingId,
  defId: IdSchema,
  anchor: CellSchema,
  rotation: RotationSchema,
  placedAt: TimestampSchema,
  investedValue: IntegerSchema,
  status: z.enum(['CONSTRUCTING', 'ACTIVE']),
  buildEndsAt: TimestampSchema,
  cashPaid: IntegerSchema,
  materialsPaid: CostSchema,
  accrued: z.number().finite().nonnegative().optional(),
  settledAt: TimestampSchema.optional(),
  slots: z.array(z.array(ProductionJobSchema).max(3)).optional(),
}).strict();

export const PlacedBridgeSchema = z.object({
  id: bridgeId,
  typeId: z.enum(['bridge_wood', 'bridge_stone', 'bridge_concrete']),
  a: CellSchema, b: CellSchema,
  deckHeightDm: z.number().finite().min(-32768).max(32767),
  buildEndsAt: TimestampSchema,
  placedAt: TimestampSchema,
  status: z.enum(['CONSTRUCTING', 'ACTIVE']),
  cashPaid: IntegerSchema,
  materialsPaid: CostSchema,
  investedValue: IntegerSchema,
}).strict();

export const PlantedCropSchema = z.object({ cell: CellSchema, cropId: IdSchema, plantedAt: TimestampSchema, readyAt: TimestampSchema }).strict();
export const ProgressSchema = z.object({
  xp: IntegerSchema, level: IntegerSchema.min(1).max(20), questIndex: IntegerSchema,
  questProgress: z.record(IdSchema, IntegerSchema), tutorialDone: z.boolean(),
}).strict();

export const WorldSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  worldId: IdSchema, accountId: IdSchema, mapId: IdSchema, mapKind: MapKindSchema,
  templateVersion: IntegerSchema.min(1), contentVersion: IntegerSchema.min(1),
  seed: IntegerSchema.max(0xffffffff), generatorVersion: z.string().min(1).max(128),
  revision: IntegerSchema, serverTime: TimestampSchema,
  character: z.object({ displayName: z.string().trim().min(1).max(64), tag: z.string().regex(/^\d{4}$/), createdAt: TimestampSchema, netWorth: IntegerSchema }).strict(),
  wallet: CostSchema,
  progress: ProgressSchema,
  unlockedZones: z.array(zoneId).min(1).max(64).refine(values => unique(values, String), 'Duplicate unlocked zone'),
  landValue: IntegerSchema,
  delta: WorldDeltaSchema,
  buildings: z.array(PlacedBuildingSchema).max(GRID * GRID),
  bridges: z.array(PlacedBridgeSchema).max(GRID * GRID),
  crops: z.array(PlantedCropSchema).max(GRID * GRID),
  inventory: z.record(IdSchema, IntegerSchema),
}).strict();

export type EnvInstance = z.infer<typeof EnvInstanceSchema>;
export type EnvSpec = z.infer<typeof EnvSpecSchema>;
export type WorldTemplate = z.infer<typeof WorldTemplateSchema>;
export type ZoneDelta = z.infer<typeof ZoneDeltaSchema>;
export type WorldDelta = z.infer<typeof WorldDeltaSchema>;
export type ProductionJob = z.infer<typeof ProductionJobSchema>;
export type PlacedBuilding = z.infer<typeof PlacedBuildingSchema>;
export type PlacedBridge = z.infer<typeof PlacedBridgeSchema>;
export type PlantedCrop = z.infer<typeof PlantedCropSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export const worldTemplateSchema = WorldTemplateSchema;
export const worldSnapshotSchema = WorldSnapshotSchema;
