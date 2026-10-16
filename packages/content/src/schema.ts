import { z } from 'zod';
import { CostSchema } from '@xay-nha/contracts';
import type { ContentCatalog } from '@xay-nha/contracts';

const integer = z.number().int().nonnegative();
const positive = integer.positive();
const text = z.string().min(1);
const mapKinds = z.array(z.enum(['city', 'farm'])).min(1);
const named = { id: text, nameKey: text };
const building = z.object({
  ...named, mapKinds, size: z.tuple([positive, positive]),
  entranceSide: z.enum(['N', 'E', 'S', 'W']), cost: CostSchema,
  unlockLevel: positive.max(20), buildSeconds: integer, buildXp: integer.optional(),
  maxCount: positive.optional(), limit: z.tuple([integer, z.number().nonnegative(), positive]).optional(),
  costScaling: z.array(integer).optional(), unlockLevels: z.array(positive.max(20)).optional(),
  population: integer.optional(), jobs: integer.optional(), baseRatePerHour: integer.optional(),
  decor: z.object({ bonus: z.number().nonnegative(), radius: integer }).strict().optional(),
  waterBonusOverride: z.number().nonnegative().optional(), bankCapHours: integer.optional(),
  production: z.object({ slots: positive, queueLimit: positive, recipes: z.array(text).min(1) }).strict().optional(),
  storageBonus: integer.optional(), fieldQuota: integer.optional(), irrigationRadius: integer.optional(),
  modelId: text,
}).strict();
const crop = z.object({
  ...named, unlockLevel: positive.max(20), seedCost: integer, growSeconds: positive,
  yield: positive, itemId: text, xp: integer, stageModels: z.tuple([text, text, text]),
}).strict();
const recipe = z.object({ id: text, inputs: z.record(positive), output: text, seconds: positive, xp: integer }).strict();
const item = z.object({ ...named, sellPrice: integer, iconId: text }).strict();
const bridge = z.object({
  ...named, maxSpan: positive, costPerCell: CostSchema, unlockLevel: positive.max(20),
  mapKinds, buildSecondsPerCell: positive,
}).strict();
const quest = z.object({
  ...named, kind: text, action: text, target: positive, buildingId: text.optional(), cropId: text.optional(),
  requiresRoad: z.boolean().optional(), farBank: z.boolean().optional(), reward: CostSchema,
  xp: integer, tutorial: z.boolean(),
}).strict();

export const CatalogSchema: z.ZodType<ContentCatalog> = z.object({
  contentVersion: positive,
  buildings: z.record(building), crops: z.record(crop), recipes: z.record(recipe),
  items: z.record(item), bridges: z.record(bridge), quests: z.object({ city: z.array(quest), farm: z.array(quest), town: z.array(quest) }).strict(),
}).strict().superRefine((catalog, context) => {
  for (const key of ['buildings', 'crops', 'recipes', 'items', 'bridges'] as const) {
    for (const [id, value] of Object.entries(catalog[key])) {
      if (id !== value.id) context.addIssue({ code: 'custom', path: [key, id, 'id'], message: 'Catalog key must match definition id' });
    }
  }
});
