import { GRID, Surface, cellIndex, type Cell, type WorldTemplate } from '@xay-nha/contracts';
import { inBounds, neighbors, type SimState } from './state';

// Water topology cannot change through commands (snapshot validation also rejects WATER_CHANGED).
// Dry surface edits preserve components; clones/reloads use new arrays. Weak keys allow old states to be collected.
const componentsBySurface = new WeakMap<Uint8Array, Int32Array>();
const authoredRegions = new WeakMap<NonNullable<WorldTemplate['bankRegions']>, Map<number, string>>();

function components(surface: Uint8Array): Int32Array {
  const cached = componentsBySurface.get(surface);
  if (cached) return cached;
  const labels = new Int32Array(GRID * GRID), queue = new Uint32Array(GRID * GRID);
  let region = 0, tail = 0;
  const enqueue = (index: number): void => {
    if (labels[index] || surface[index] === Surface.WATER) return;
    labels[index] = region;
    queue[tail++] = index;
  };
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || surface[start] === Surface.WATER) continue;
    region++; tail = 0; enqueue(start);
    for (let head = 0; head < tail; head++) {
      const index = queue[head]!, x = index % GRID;
      if (x > 0) enqueue(index - 1);
      if (x < GRID - 1) enqueue(index + 1);
      if (index >= GRID) enqueue(index - GRID);
      if (index < GRID * (GRID - 1)) enqueue(index + GRID);
    }
  }
  componentsBySurface.set(surface, labels);
  return labels;
}

// Preserve the original flood semantics for synthetic water/out-of-bounds inputs.
function legacyFlood(s: SimState, starts: Cell[]): Uint8Array {
  const visited = new Uint8Array(GRID * GRID), queue = [...starts];
  for (const cell of starts) visited[cellIndex(...cell)] = 1;
  for (let head = 0; head < queue.length; head++) for (const next of neighbors(queue[head]!)) {
    const index = cellIndex(...next);
    if (!visited[index] && s.surface[index] !== Surface.WATER) { visited[index] = 1; queue.push(next); }
  }
  return visited;
}

export function isFarBank(s: SimState, cells: Cell[]): boolean {
  if (!cells.length) return false;
  const bridges = s.snapshot.bridges.filter(bridge => bridge.status === 'ACTIVE');
  if (!bridges.length) return false;
  const regions = s.template.bankRegions;
  if (regions) {
    let regionAt = authoredRegions.get(regions);
    if (!regionAt) {
      regionAt = new Map();
      for (const region of regions) for (const cell of region.cells) regionAt.set(cellIndex(...cell), region.id);
      authoredRegions.set(regions, regionAt);
    }
    const at = (cell: Cell) => regionAt.get(cellIndex(...cell));
    const home = new Set(s.template.entryCells.map(at).filter((id): id is string => id !== undefined));
    const target = at(cells[0]!);
    return target !== undefined && !home.has(target) && cells.every(cell => at(cell) === target)
      && bridges.some(bridge => (home.has(at(bridge.a) ?? '') && at(bridge.b) === target)
        || (home.has(at(bridge.b) ?? '') && at(bridge.a) === target));
  }
  const dry = (cell: Cell) => inBounds(cell) && s.surface[cellIndex(...cell)] !== Surface.WATER;
  if (!cells.every(dry) || !s.template.entryCells.every(dry)) {
    const home = legacyFlood(s, s.template.entryCells), target = legacyFlood(s, cells);
    return cells.every(cell => !home[cellIndex(...cell)]) && bridges.some(bridge =>
      (home[cellIndex(...bridge.a)] && target[cellIndex(...bridge.b)])
      || (home[cellIndex(...bridge.b)] && target[cellIndex(...bridge.a)]));
  }
  const labels = components(s.surface), at = (cell: Cell) => labels[cellIndex(...cell)];
  const home = new Set(s.template.entryCells.map(at));
  if (cells.some(cell => home.has(at(cell)))) return false;
  // The old multi-source flood accepts a union of far components; keep that behavior.
  const target = new Set(cells.map(at));
  return bridges.some(bridge => (home.has(at(bridge.a)) && target.has(at(bridge.b)))
    || (home.has(at(bridge.b)) && target.has(at(bridge.a))));
}
