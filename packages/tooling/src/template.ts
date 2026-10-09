import type { MapKind, WorldTemplate } from '@xay-nha/contracts';
import { createTestTemplate, validateTemplate } from '@xay-nha/worldgen';
import { buildAuthoredTemplate, type AuthoredLayout } from './authored-template';

export interface FixtureLayout {
  schemaVersion: 1;
  provisional: true;
  kind: 'rule-fixture';
  mapKind: MapKind;
  mapId: string;
  seed: number;
  bankRegions?: WorldTemplate['bankRegions'];
}

/** G0 authored fixture layout. Full City/Farm vector layout authoring belongs to G3. */
export function buildTemplate(input: unknown): WorldTemplate {
  if (typeof input !== 'object' || input === null) throw new Error('Layout must be an object');
  if ('kind' in input && input.kind === 'authored-fixture') {
    const allowed = new Set(['schemaVersion', 'provisional', 'kind', 'mapKind', 'mapId', 'seed', 'waterLevelDm', 'water', 'startZones', 'entryCells', 'roads', 'suggestedLots', 'bankRegions', 'protectedCells', 'camera']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Unknown authored layout field');
    const layout = input as AuthoredLayout;
    if (layout.schemaVersion !== 1 || layout.provisional !== true || !Array.isArray(layout.roads) || !Array.isArray(layout.protectedCells) || !Array.isArray(layout.suggestedLots)) throw new Error('Invalid provisional authored layout');
    return buildAuthoredTemplate(layout);
  }
  const layout = input as Partial<FixtureLayout>;
  const allowed = new Set(['schemaVersion', 'provisional', 'kind', 'mapKind', 'mapId', 'seed', 'bankRegions']);
  const errors: string[] = [];
  for (const key of Object.keys(layout)) if (!allowed.has(key)) errors.push(`Unknown layout field: ${key}`);
  if (layout.schemaVersion !== 1 || layout.provisional !== true || layout.kind !== 'rule-fixture') errors.push('Expected provisional schemaVersion 1 rule-fixture layout');
  if (layout.mapKind !== 'city' && layout.mapKind !== 'farm') errors.push('mapKind must be city or farm');
  if (typeof layout.mapId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(layout.mapId)) errors.push('Invalid mapId');
  if (!Number.isInteger(layout.seed) || layout.seed! < 0 || layout.seed! > 0xffffffff) errors.push('seed must be uint32');
  if (errors.length) throw new Error(errors.join('\n'));
  const template = createTestTemplate(layout.mapKind);
  template.mapId = layout.mapId!; template.seed = layout.seed!;
  if (layout.bankRegions !== undefined) template.bankRegions = layout.bankRegions;
  const validation = validateTemplate(template);
  if (validation.length) throw new Error(validation.join('\n'));
  return template;
}
