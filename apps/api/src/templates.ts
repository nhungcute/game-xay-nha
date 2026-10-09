import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorldTemplateSchema, type EnvInstance, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { generateEnvironment, validateTemplate } from '@xay-nha/worldgen';

export interface LoadedTemplate { template: WorldTemplate; env: EnvInstance[]; path: string }

/** Immutable world templates served to clients as static files and used by the server for validation. */
export class TemplateRegistry {
  private readonly byKey = new Map<string, LoadedTemplate>();
  private readonly latest = new Map<MapKind, LoadedTemplate>();

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
  get(mapId: string, version: number): LoadedTemplate | undefined { return this.byKey.get(`${mapId}@${version}`); }
  latestFor(kind: MapKind): LoadedTemplate | undefined { return this.latest.get(kind); }
  maps(): { mapKind: MapKind; mapId: string; templateVersion: number; url: string }[] {
    return [...this.latest.values()].map(({ template }) => ({ mapKind: template.mapKind, mapId: template.mapId, templateVersion: template.templateVersion,
      url: `/worlds/${template.mapId}/template.v${template.templateVersion}.json` }));
  }
}
