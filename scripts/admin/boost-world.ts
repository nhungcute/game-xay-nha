// One-off admin tool (TinTin upgrade): max level, all zones, one of every building (ACTIVE), wallet 1M/1M/1M.
// Everything goes through the sim's own execute() so rules stay valid; the result is re-validated like WorldService.restore.
// Usage: npx tsx scripts/admin/boost-world.ts <before.json> <after.json> <update.sql>
//   <before.json> = json_agg of the worlds rows (all columns). Writes no DB; <update.sql> is applied separately via psql.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { CellFlag, Surface, WorldTemplateSchema, cellIndex, type Cell, type Rotation, type WorldSnapshot } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import {
  access, advanceTime, createState, execute, footprintCells, isShore, recompute, validateSnapshot, type SimState,
} from '@xay-nha/sim';
import { generateEnvironment, validateTemplate } from '@xay-nha/worldgen';

const [beforePath, afterPath, sqlPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !sqlPath) throw new Error('usage: boost-world.ts before.json after.json update.sql');
const TARGET_WALLET = 1_000_000;
const NOW = Date.now();

interface Row { id: string; account_id: string; map_id: string; map_kind: 'city' | 'farm'; template_version: number; revision: number; updated_at: string; snapshot: WorldSnapshot }

async function boost(row: Row) {
  const template = WorldTemplateSchema.parse(JSON.parse(await readFile(`apps/web/public/worlds/${row.map_id}/template.v${row.template_version}.json`, 'utf8')));
  const tErrors = validateTemplate(template);
  if (tErrors.length) throw new Error(`template invalid: ${tErrors.slice(0, 3)}`);
  const env = generateEnvironment(template);
  const snap0 = row.snapshot;
  const identity = { worldId: snap0.worldId, accountId: snap0.accountId, displayName: snap0.character.displayName, tag: snap0.character.tag };
  // Same load path as WorldService.restore
  const mk = () => createState(template, Math.min(NOW, snap0.serverTime), env, identity);
  const loaded = validateSnapshot(mk(), snap0, NOW);
  if (!loaded.ok) throw new Error(`stored snapshot invalid: ${loaded.errors.slice(0, 5)}`);
  let state: SimState = loaded.state;
  recompute(state);
  const oldRevision = snap0.revision;
  const kind = template.mapKind;
  const maxLevel = economy.xp.maxLevel, maxXp = economy.xp.cumulative[kind][maxLevel]!;

  const run = (st: SimState, type: string, payload: unknown) =>
    execute(st, { commandId: randomUUID(), worldId: st.snapshot.worldId, expectedRevision: st.snapshot.revision, clientTime: NOW, type, payload }, NOW);
  const must = (type: string, payload: unknown) => {
    const ex = run(state, type, payload);
    if (!ex.result.accepted) throw new Error(`${type} rejected: ${ex.result.code} ${JSON.stringify(ex.result.detail)}`);
    state = ex.state;
  };

  // The first command's advanceTime settles income / finishes constructions like the API; do it explicitly here.
  advanceTime(state, NOW);
  // Temporary: huge wallet + max level so every rule can be satisfied; wallet is reset at the end.
  state.snapshot.wallet = { cash: 10 ** 12, wood: 10 ** 9, stone: 10 ** 9 };
  state.snapshot.progress.level = maxLevel;
  state.snapshot.progress.xp = Math.max(state.snapshot.progress.xp, maxXp);

  // 1. Zones (adjacency order)
  for (;;) {
    const owned = new Set(state.snapshot.unlockedZones);
    if (owned.size >= 64) break;
    let next = -1;
    for (let z = 0; z < 64 && next < 0; z++) {
      if (owned.has(z)) continue;
      const x = z % 8, zz = Math.floor(z / 8);
      if ([...owned].some(o => Math.abs(o % 8 - x) + Math.abs(Math.floor(o / 8) - zz) === 1)) next = z;
    }
    if (next < 0) throw new Error('no adjacent zone');
    must('UNLOCK_ZONE', { zoneId: next });
  }

  // 2. Buildings: biggest first, closest to the start area, each with a road cell touching it.
  const defs = Object.values(catalog.buildings).filter(d => d.mapKinds.includes(kind));
  const existing = new Set(state.snapshot.buildings.map(b => b.defId));
  const todo = defs.filter(d => !existing.has(d.id)).sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1]);
  let cx = 0, cz = 0;
  for (const z of template.startZones) { cx += (z % 8) * 16 + 8; cz += Math.floor(z / 8) * 16 + 8; }
  cx /= template.startZones.length; cz /= template.startZones.length;

  const placed: { id: string; defId: string; anchor: Cell; rotation: number; status: string }[] = [];
  const failures: { defId: string; reason: string }[] = [];
  const playerRoads = (st: SimState) => { let n = 0; for (let i = 0; i < st.roadTier.length; i++) if (st.roadTier[i] && !st.baseRoadTier[i]) n++; return n; };
  const baseRoads = playerRoads(state);
  const inGrid = (c: Cell) => c[0] >= 0 && c[1] >= 0 && c[0] < 128 && c[1] < 128;
  const around = (c: Cell): Cell[] => [[c[0] - 1, c[1]], [c[0] + 1, c[1]], [c[0], c[1] - 1], [c[0], c[1] + 1]];
  const cornerVerts = (cells: Cell[]) => {
    const vs = new Set<number>();
    for (const c of cells) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) vs.add((c[1] + dz!) * 129 + c[0] + dx!);
    return vs;
  };

  for (const def of todo) {
    type Cand = { anchor: Cell; rot: Rotation; score: number };
    const cands: Cand[] = [];
    for (const rot of [0, 1] as Rotation[]) {
      const [w, d] = rot % 2 === 0 ? def.size : [def.size[1], def.size[0]];
      for (let z = 1; z + d < 127; z++) for (let x = 1; x + w < 127; x++) {
        const cells = footprintCells(def, [x, z], rot);
        let ok = true;
        const seenEnv = new Set<string>();
        for (const c of cells) {
          const i = cellIndex(...c), f = state.flags[i]!, sf = state.surface[i]!;
          if (sf === Surface.WATER || sf === Surface.ROAD || sf === Surface.TILLED || (f & (CellFlag.NO_BUILD | CellFlag.PROTECTED | CellFlag.ENTRY)) || (isShore(state, c) && !(f & CellFlag.EMBANKED))) { ok = false; break; }
          const occ = state.occupancy.get(i);
          if (occ) { if (occ.startsWith('b_') || occ.startsWith('br_') || occ.startsWith('crop')) { ok = false; break; } seenEnv.add(occ); }
        }
        if (!ok || seenEnv.size > 12) continue;
        let hmin = Infinity, hmax = -Infinity;
        for (const v of cornerVerts(cells)) { const h = state.heights[v]!; hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
        if (hmax - hmin > 40) continue;
        cands.push({ anchor: [x, z], rot, score: Math.hypot(x + w / 2 - cx, z + d / 2 - cz) + seenEnv.size * 1.5 + (hmax - hmin) / 5 });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    let done = false, tries = 0, lastErr = cands.length ? 'all candidates rejected' : 'no candidate';
    for (const cand of cands) {
      if (++tries > 600) break;
      let st = state;
      const cells = footprintCells(def, cand.anchor, cand.rot);
      const envIds = new Set<string>();
      for (const c of cells) { const o = st.occupancy.get(cellIndex(...c)); if (o && !o.startsWith('b_')) envIds.add(o); }
      if (envIds.size) {
        const ex = run(st, 'CLEAR_ENV', { envIds: [...envIds] });
        if (!ex.result.accepted) { lastErr = `CLEAR_ENV ${ex.result.code}`; continue; }
        st = ex.state;
      }
      let ex = run(st, 'PLACE_BUILDING', { defId: def.id, anchor: cand.anchor, rotation: cand.rot });
      if (!ex.result.accepted && ex.result.code === 'NOT_FLAT') {
        const vs = [...cornerVerts(cells)];
        const mean = vs.reduce((a, v) => a + st.heights[v]!, 0) / vs.length;
        ex = run(st, 'PLACE_BUILDING', { defId: def.id, anchor: cand.anchor, rotation: cand.rot, autoFlattenHDm: Math.round(mean / 5) * 5 });
      }
      if (!ex.result.accepted) { lastErr = `PLACE ${ex.result.code}`; continue; }
      st = ex.state;
      const b = st.snapshot.buildings[st.snapshot.buildings.length - 1]!;
      if (b.status === 'CONSTRUCTING') {
        const sp = run(st, 'SPEED_UP', { buildingId: b.id });
        if (!sp.result.accepted) { lastErr = `SPEED_UP ${sp.result.code}`; continue; }
        st = sp.state;
      }
      if (!access(st, st.snapshot.buildings.find(x => x.id === b.id)!)) {
        const own = new Set(cells.map(c => cellIndex(...c)));
        const peri: { c: Cell; pref: number }[] = [];
        for (const c of cells) for (const n of around(c)) {
          if (!inGrid(n) || own.has(cellIndex(...n)) || st.occupancy.has(cellIndex(...n))) continue;
          peri.push({ c: n, pref: -around(n).filter(m => inGrid(m) && st.roadTier[cellIndex(...m)]).length });
        }
        peri.sort((a, b2) => a.pref - b2.pref);
        let roadOk = false;
        for (const p of peri.slice(0, 8)) {
          const rr = run(st, 'BUILD_ROAD', { tier: 1, cells: [p.c] });
          if (rr.result.accepted) { st = rr.state; roadOk = true; break; }
          lastErr = `ROAD ${rr.result.code}`;
        }
        if (!roadOk) continue;
      }
      const fin = st.snapshot.buildings.find(x => x.id === b.id)!;
      if (fin.status !== 'ACTIVE' || !access(st, fin)) { lastErr = 'not active/connected'; continue; }
      state = st; done = true;
      placed.push({ id: fin.id, defId: def.id, anchor: fin.anchor as Cell, rotation: fin.rotation, status: fin.status });
      break;
    }
    if (!done) failures.push({ defId: def.id, reason: lastErr });
  }

  // 2b. Pre-existing buildings without a road get one road cell too (owner asked every building to touch a road).
  for (const b of [...state.snapshot.buildings]) {
    if (access(state, b)) continue;
    const def = catalog.buildings[b.defId]!, cells = footprintCells(def, b.anchor as Cell, b.rotation), own = new Set(cells.map(c => cellIndex(...c)));
    const peri: Cell[] = [];
    for (const c of cells) for (const n of around(c)) if (inGrid(n) && !own.has(cellIndex(...n)) && !state.occupancy.has(cellIndex(...n))) peri.push(n);
    let ok = false;
    for (const p of peri) {
      const rr = run(state, 'BUILD_ROAD', { tier: 1, cells: [p] });
      if (rr.result.accepted) { state = rr.state; ok = true; break; }
    }
    if (!ok) failures.push({ defId: b.defId, reason: `existing ${b.id}: no road cell possible` });
  }

  // 3. Final values (after all costs)
  const snap = state.snapshot;
  snap.wallet = { cash: TARGET_WALLET, wood: TARGET_WALLET, stone: TARGET_WALLET };
  snap.progress.level = maxLevel;
  snap.progress.xp = maxXp;
  snap.revision = oldRevision + 1;
  recompute(state);
  const verdict = validateSnapshot(mk(), JSON.parse(JSON.stringify(state.snapshot)), NOW + 1000);
  const errors = verdict.ok ? [] : verdict.errors;
  const report = {
    worldId: row.id, mapId: row.map_id, level: snap.progress.level, xp: snap.progress.xp, zones: snap.unlockedZones.length,
    buildings: state.snapshot.buildings.map(b => ({ id: b.id, defId: b.defId, anchor: b.anchor, rotation: b.rotation, status: b.status, connected: access(state, b) > 0 })),
    newlyPlaced: placed, failures, roadCellsAdded: playerRoads(state) - baseRoads, roadCellsTotalPlayer: playerRoads(state),
    wallet: snap.wallet, netWorth: snap.character.netWorth, landValue: snap.landValue, oldRevision, newRevision: snap.revision, serverTime: snap.serverTime,
    validationErrors: errors,
  };
  return { snapshot: snap, report };
}

const rows = JSON.parse(await readFile(beforePath, 'utf8')) as Row[];
const out: unknown[] = [];
let sql = 'DO $do$ BEGIN\n';
for (const row of rows) {
  const { snapshot, report } = await boost(row);
  out.push({ id: row.id, level: snapshot.progress.level, net_worth: snapshot.character.netWorth, revision: snapshot.revision, snapshot, report });
  console.log(JSON.stringify({ ...report, buildings: undefined }, null, 1));
  console.log(report.buildings.map(b => `${b.id} ${b.defId} @${b.anchor} ${b.status}${b.connected ? '' : ' NOROAD'}`).join('\n'));
  if (report.validationErrors.length || report.failures.length) { console.log('NOT CLEAN'); process.exitCode = 1; }
  const json = JSON.stringify(snapshot);
  if (json.includes('$json$')) throw new Error('unsafe json');
  sql += `UPDATE worlds SET snapshot = $json$${json}$json$::jsonb, level = ${snapshot.progress.level}, net_worth = ${snapshot.character.netWorth}, revision = ${snapshot.revision}, updated_at = now()\n`
    + `  WHERE id = '${row.id}' AND revision = ${row.revision};\n  IF NOT FOUND THEN RAISE EXCEPTION 'REVISION CHANGED for ${row.id}'; END IF;\n`;
}
sql += 'END $do$;\n';
await writeFile(afterPath, JSON.stringify(out, null, 1));
await writeFile(sqlPath, sql);
