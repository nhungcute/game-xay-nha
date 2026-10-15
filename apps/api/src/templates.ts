import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorldTemplateSchema, type EnvInstance, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { generateEnvironment, validateTemplate } from '@xay-nha/worldgen';

export interface LoadedTemplate { template: WorldTemplate; env: EnvInstance[]; path: string; json?: string; etag?: string }

/** Key-sorted JSON: Postgres jsonb does not keep key order, so the ETag must not depend on it. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
}

/** D039: random map ids (`rnd-<kind>-<seed>`) are resolved from the database, never from files. */
export const isRandomMapId = (mapId: string): boolean => mapId.startsWith('rnd-');
export type RandomTemplateLoader = (worldId: string) => Promise<WorldTemplate | undefined>;

/** Immutable world templates: static ones from files, random ones from `world_templates` through a bounded LRU. */
export class TemplateRegistry {
  private readonly byKey = new Map<string, LoadedTemplate>();
  private readonly latest = new Map<MapKind, LoadedTemplate>();
  private readonly randomCache = new Map<string, LoadedTemplate>();
  private loader: RandomTemplateLoader | undefined;

  constructor(private readonly randomCacheSize = 32) {}

  static async load(dir: string): Promise<TemplateRegistry> {
    const registry = new TemplateRegistry();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const file of (await readdir(join(dir, entry.name))).filter(f => /^template\.v\d+\.json$/.test(f))) {
        const path = join(dir, entry.name, file);
        const template = WorldTemplateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
        const errors = validateTemplate(template);
        if (errors.length) throw new Error(`Invalid template ${path}: ${errors.slice(0, 3).join('; ')}`);
        registry.add({ template, env: generateEnvironment(template), path });
      }
    }
    return registry;
  }
  add(t: LoadedTemplate): void {
    this.byKey.set(`${t.template.mapId}@${t.template.templateVersion}`, t);
    const current = this.latest.get(t.template.mapKind);
    if (!current || current.template.templateVersion < t.template.templateVersion) this.latest.set(t.template.mapKind, t);
  }
  /** Static lookup only (files). Random maps go through {@link forWorld}. */
  get(mapId: string, version: number): LoadedTemplate | undefined { return this.byKey.get(`${mapId}@${version}`); }
  latestFor(kind: MapKind): LoadedTemplate | undefined { return this.latest.get(kind); }
  maps(): { mapKind: MapKind; mapId: string; templateVersion: number; url: string }[] {
    return [...this.latest.values()].map(({ template }) => ({ mapKind: template.mapKind, mapId: template.mapId, templateVersion: template.templateVersion,
      url: `/worlds/${template.mapId}/template.v${template.templateVersion}.json` }));
  }

  setRandomLoader(loader: RandomTemplateLoader): void { this.loader = loader; }

  /** Caches a freshly generated template (the creating request already holds env and JSON). */
  cacheRandom(worldId: string, template: WorldTemplate, env: EnvInstance[]): LoadedTemplate {
    return this.remember(worldId, { template, env, path: `db:${worldId}` });
  }

  /** The template a world must be validated and executed against: static by id@version, random from the database. */
  async forWorld(worldId: string, mapId: string, version: number): Promise<LoadedTemplate | undefined> {
    if (!isRandomMapId(mapId)) return this.get(mapId, version);
    const hit = this.randomCache.get(worldId);
    if (hit) { this.randomCache.delete(worldId); this.randomCache.set(worldId, hit); return hit; }
    const stored = await this.loader?.(worldId);
    if (!stored || stored.mapId !== mapId || stored.templateVersion !== version) return undefined;
    return this.remember(worldId, { template: stored, env: generateEnvironment(stored), path: `db:${worldId}` });
  }

  /** Serialised template + strong ETag for the template endpoint (computed once per cached entry). */
  static payload(loaded: LoadedTemplate): { json: string; etag: string } {
    loaded.json ??= canonicalJson(loaded.template);
    loaded.etag ??= `"${createHash('sha1').update(loaded.json).digest('base64url')}"`;
    return { json: loaded.json, etag: loaded.etag };
  }

  private remember(worldId: string, loaded: LoadedTemplate): LoadedTemplate {
    this.randomCache.set(worldId, loaded);
    while (this.randomCache.size > this.randomCacheSize) this.randomCache.delete(this.randomCache.keys().next().value as string);
    return loaded;
  }
}
