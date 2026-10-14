import { CellFlag, Surface, WorldTemplateSchema } from '@xay-nha/contracts';
import { cellFootprint, cellVertices, rasterizeWater, zoneOfCell } from './geometry';
import { decodeLayers, type DecodedLayers } from './layers';

/** Accumulate independent failures; callers swap state only after this succeeds. */
export function validateTemplate(input: unknown): string[] {
  const parsed = WorldTemplateSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
  const template = parsed.data, errors: string[] = [];
  let layers: DecodedLayers;
  try { layers = decodeLayers(template); } catch (error) { return [`layers: ${error instanceof Error ? error.message : String(error)}`]; }
  const water = rasterizeWater(template.water), zones = new Set(template.startZones);
  if (template.bankRegions) {
    const regionIds = new Set<string>(), claimed = new Set<number>();
    for (const region of template.bankRegions) {
      if (regionIds.has(region.id)) errors.push(`bankRegions: duplicate ID ${region.id}`);
      regionIds.add(region.id);
      for (const [x, z] of region.cells) {
        const index = z * 128 + x;
        if (claimed.has(index)) errors.push(`bankRegions: overlapping cell ${x},${z}`);
        claimed.add(index);
        if (water[index]) errors.push(`bankRegions.${region.id}: water cell ${x},${z}`);
      }
    }
    for (const [x, z] of template.entryCells) if (!claimed.has(z * 128 + x)) errors.push(`bankRegions: ENTRY outside authored regions ${x},${z}`);
  }
  const startVisited = new Set<number>(), queue = template.startZones.length ? [template.startZones[0]!] : [];
  while (queue.length) {
    const zone = queue.pop()!;
    if (startVisited.has(zone)) continue;
    startVisited.add(zone);
    for (const next of [zone % 8 > 0 ? zone - 1 : -1, zone % 8 < 7 ? zone + 1 : -1, zone - 8, zone + 8]) if (zones.has(next) && !startVisited.has(next)) queue.push(next);
  }
  if (zones.size !== template.startZones.length) errors.push('startZones: duplicate zones');
  if (startVisited.size !== zones.size || !zones.size) errors.push('startZones: must be nonempty and connected');
  const entries = new Set(template.entryCells.map(([x, z]) => z * 128 + x));
  if (entries.size !== template.entryCells.length) errors.push('entryCells: duplicates');
  let buildable = 0;
  const anchorOccupied = new Set<number>(), anchorIds = new Set<string>();
  for (const anchor of template.env.anchors) {
    if (!/^A-\d+$/.test(anchor.id)) errors.push(`env.anchors: invalid manual anchor ID ${anchor.id}`);
    if (anchorIds.has(anchor.id)) errors.push(`env.anchors: duplicate ID ${anchor.id}`);
    anchorIds.add(anchor.id);
    for (const [x, z] of cellFootprint(...anchor.cell, anchor.footprint)) {
      if (x >= 128 || z >= 128) { errors.push(`env.anchors.${anchor.id}: footprint outside map`); continue; }
      const i = z * 128 + x;
      if (layers.surface[i] === Surface.WATER || layers.roadTier[i]! > 0 || (layers.flags[i]! & CellFlag.ENTRY)) errors.push(`env.anchors.${anchor.id}: on water, road or entry`);
      if (anchor.blocking) {
        if (anchorOccupied.has(i)) errors.push(`env.anchors.${anchor.id}: blocking overlap at ${x},${z}`);
        anchorOccupied.add(i);
        if (template.suggestedLots?.some(lot => x >= lot.cells[0] && x <= lot.cells[2] && z >= lot.cells[1] && z <= lot.cells[3])) errors.push(`env.anchors.${anchor.id}: blocking suggested lot`);
      }
    }
  }
  const scatterKeys = new Set<string>();
  template.env.scatter.forEach((spec, index) => {
    const key = `${spec.biome}:${spec.category}`;
    if (scatterKeys.has(key)) errors.push(`env.scatter.${index}: duplicate biome/category creates duplicate IDs`);
    scatterKeys.add(key);
  });
  const waterIds = new Set<string>();
  for (const body of [...template.water.lakes, ...template.water.rivers, ...template.water.waterfalls]) {
    if (waterIds.has(body.id)) errors.push(`water: duplicate ID ${body.id}`);
    waterIds.add(body.id);
  }
  for (const lot of template.suggestedLots ?? []) if (lot.cells[0] > lot.cells[2] || lot.cells[1] > lot.cells[3]) errors.push(`suggestedLots.${lot.id}: inverted rectangle`);
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
    const i = z * 128 + x, wet = layers.surface[i] === Surface.WATER, zone = zoneOfCell(x, z);
    if (layers.surface[i]! > Surface.WATER) errors.push(`surface.${x},${z}: unknown surface enum`);
    if (layers.flags[i]! & ~15) errors.push(`flags.${x},${z}: unknown cell flags`);
    if (wet !== Boolean(water[i])) errors.push(`surface.${x},${z}: water raster mismatch`);
    if (layers.surface[i] === Surface.TILLED || layers.surface[i] === Surface.FOUNDATION) errors.push(`surface.${x},${z}: player surface in template`);
    if (layers.flags[i]! & CellFlag.EMBANKED) errors.push(`flags.${x},${z}: template embankment`);
    if (layers.roadTier[i]! > 1) errors.push(`roadTier.${x},${z}: paved road in template`);
    if (layers.roadTier[i] === 1 && wet) errors.push(`roadTier.${x},${z}: road touches water`);
    if ((layers.surface[i] === Surface.ROAD) !== (layers.roadTier[i]! > 0)) errors.push(`roadTier.${x},${z}: surface/road mismatch`);
    if (layers.roadTier[i]! > 0 && !zones.has(zone) && !(layers.flags[i]! & CellFlag.PROTECTED)) errors.push(`flags.${x},${z}: external village road must be protected`);
    if ((layers.flags[i]! & CellFlag.ENTRY) && !entries.has(i)) errors.push(`flags.${x},${z}: undeclared ENTRY`);
    if (entries.has(i)) {
      if (!zones.has(zone)) errors.push(`entryCells.${x},${z}: outside startZones`);
      if (!(layers.flags[i]! & CellFlag.ENTRY) || layers.roadTier[i]! < 1) errors.push(`entryCells.${x},${z}: missing ENTRY flag or road`);
    }
    const heights = cellVertices(x, z).map(v => layers.heightsDm[v]!);
    if (layers.roadTier[i]! > 0 && Math.max(...heights) - Math.min(...heights) > 5) errors.push(`roadTier.${x},${z}: road slope exceeds 5dm`);
    if (!wet && zones.has(zone) && !layers.roadTier[i] && !(layers.flags[i]! & (CellFlag.NO_BUILD | CellFlag.PROTECTED))
      && Math.max(...heights) - Math.min(...heights) <= 10 && !anchorOccupied.has(i)) buildable++;
  }
  if (buildable < 200) errors.push(`startZones: only ${buildable} buildable cells; requires 200`);
  // D002: shared water/land vertices are above water; water-only vertices are below water.
  for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) {
    const adjacent: boolean[] = [];
    for (const cz of [z - 1, z]) for (const cx of [x - 1, x]) if (cx >= 0 && cx < 128 && cz >= 0 && cz < 128) adjacent.push(layers.surface[cz * 128 + cx] === Surface.WATER);
    if (!adjacent.some(Boolean)) continue;
    const height = layers.heightsDm[z * 129 + x]!;
    if (adjacent.every(Boolean)) {
      if (height > template.waterLevelDm - 5) errors.push(`heightsDm.${x},${z}: water-only vertex above waterLevel-5`);
    } else if (height < template.waterLevelDm + 5 || height > template.waterLevelDm + 20) errors.push(`heightsDm.${x},${z}: shared shore outside waterLevel+[5,20] (D002)`);
  }
  for (const [entryX, entryZ] of template.entryCells) {
    const visited = new Set<number>(), roadQueue = [entryZ * 128 + entryX];
    let reachesEdge = false;
    while (roadQueue.length) {
      const i = roadQueue.pop()!;
      if (visited.has(i) || !layers.roadTier[i]) continue;
      visited.add(i);
      const x = i % 128, z = Math.floor(i / 128);
      if (x === 0 || x === 127 || z === 0 || z === 127) reachesEdge = true;
      if (x > 0) roadQueue.push(i - 1);
      if (x < 127) roadQueue.push(i + 1);
      if (z > 0) roadQueue.push(i - 128);
      if (z < 127) roadQueue.push(i + 128);
    }
    if (!reachesEdge) errors.push(`entryCells.${entryX},${entryZ}: no village road to map edge`);
  }
  return errors;
}
