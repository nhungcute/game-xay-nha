// Re-validates json_agg'd worlds rows exactly like WorldService.restore. Usage: npx tsx scripts/admin/verify-rows.ts rows.json
import { readFile } from 'node:fs/promises';
import { WorldTemplateSchema, type WorldSnapshot } from '@xay-nha/contracts';
import { access, createState, recompute, validateSnapshot } from '@xay-nha/sim';
import { generateEnvironment } from '@xay-nha/worldgen';

const rows = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as { id: string; level: number; revision: number; net_worth: number; snapshot: WorldSnapshot }[];
const now = Date.now();
for (const r of rows) {
  const s = r.snapshot;
  const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${s.mapId}/template.v${s.templateVersion}.json`, 'utf8')));
  const base = createState(template, Math.min(now, s.serverTime), generateEnvironment(template), { worldId: s.worldId, accountId: s.accountId, displayName: s.character.displayName, tag: s.character.tag });
  const v = validateSnapshot(base, s, now);
  if (!v.ok) { console.log(r.id, 'INVALID', v.errors.slice(0, 5)); process.exitCode = 1; continue; }
  recompute(v.state);
  const types = s.buildings.map(b => `${b.defId}:${b.status}${access(v.state, b) ? '' : ':NOROAD'}`);
  console.log(r.id, { ok: true, level: s.progress.level, rowLevel: r.level, xp: s.progress.xp, revision: r.revision, zones: s.unlockedZones.length, buildings: s.buildings.length, wallet: s.wallet, netWorth: s.character.netWorth, rowNetWorth: r.net_worth }, types.join(' '));
}
