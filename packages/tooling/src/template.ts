import type { MapKind, WorldTemplate } from '@xay-nha/contracts';
import { createTestTemplate, validateTemplate } from '@xay-nha/worldgen';

export interface FixtureLayout {
  schemaVersion: 1;
  provisional: true;
  kind: 'rule-fixture';
  mapKind: MapKind;
  mapId: string;
  seed: number;
}

/** G0 authored fixture layout. Full City/Farm vector layout authoring belongs to G3. */
export function buildTemplate(input: unknown): WorldTemplate {
  if (typeof input !== 'object' || input === null) throw new Error('Layout must be an object');
  const layout = input as Partial<FixtureLayout>;
  const allowed = new Set(['schemaVersion', 'provisional', 'kind', 'mapKind', 'mapId', 'seed']);
  const errors: string[] = [];
  for (const key of Object.keys(layout)) if (!allowed.has(key)) errors.push(`Unknown layout field: ${key}`);
  if (layout.schemaVersion !== 1 || layout.provisional !== true || layout.kind !== 'rule-fixture') errors.push('Expected provisional schemaVersion 1 rule-fixture layout');
  if (layout.mapKind !== 'city' && layout.mapKind !== 'farm') errors.push('mapKind must be city or farm');
  if (typeof layout.mapId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(layout.mapId)) errors.push('Invalid mapId');
  if (!Number.isInteger(layout.seed) || layout.seed! < 0 || layout.seed! > 0xffffffff) errors.push('seed must be uint32');
  if (errors.length) throw new Error(errors.join('\n'));
  const template = createTestTemplate(layout.mapKind);
  template.mapId = layout.mapId!; template.seed = layout.seed!;
  const validation = validateTemplate(template);
  if (validation.length) throw new Error(validation.join('\n'));
  return template;
}
