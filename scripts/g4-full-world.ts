// docs/10 §6 "full world" scenario, built by the real sim (no hand-made snapshots): Codex's EconomyBot
// (imported unchanged) plays the careful style for 60 days on each authored map; the final snapshots are
// written for scripts/g4-full-world.mjs to load in the browser and measure against docs/11 §8.
// Usage: npx tsx scripts/g4-full-world.ts [days=60]
import { readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema, Surface } from '@xay-nha/contracts';
import { EconomyBot } from '../packages/tooling/src/economy-bot-core';

const days = Number(process.argv[2] ?? 60), out = 'docs/evidence/g4/full-world';
for (const [kind, mapId] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']] as const) {
  const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8')));
  const started = Date.now(), bot = new EconomyBot(template, 'cham', days);
  bot.run();
  const s = bot.state, snap = s.snapshot;
  const summary = { mapId, days, level: snap.progress.level, buildings: snap.buildings.length, bridges: snap.bridges.length,
    zones: snap.unlockedZones.length, roadCells: [...s.roadTier].filter(t => t > 0).length,
    fields: [...s.surface].filter(v => v === Surface.TILLED).length, crops: snap.crops.length, seconds: Math.round((Date.now() - started) / 1000) };
  await writeFile(`${out}/${kind}-snapshot.json`, JSON.stringify(snap));
  console.log(kind, JSON.stringify(summary));
  await writeFile(`${out}/${kind}-world.json`, `${JSON.stringify(summary, null, 2)}\n`);
}
