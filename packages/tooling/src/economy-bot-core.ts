import { CellFlag, Surface, cellIndex, type Cell, type CommandPayload, type CommandType, type Cost, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { advanceTime, builderCapacity, buildingLimit, corners, costValue, execute, fieldQuota, footprintCells, inBounds, isShore, isUnlocked,
  meanHeight, neighbors, rebuildOccupancy, recompute, slope, validateSnapshot, createState, access, authoredQuestProgress, repeatQuestProgress, isFarBank, type SimState } from '@xay-nha/sim';
import { capHours } from '@xay-nha/sim';
import { generateEnvironment } from '@xay-nha/worldgen';
import { nextHarvestMinute, sessions, type PlayStyle, type Session } from './economy-bot-schedule';

const MINUTE = 60000;
export interface BotResult {
  mapKind: MapKind; style: PlayStyle; days: number; templateId: string; templateVersion: number; firstMinute: number;
  levelAtDays: Record<number, number>; commands: number; rejected: Record<string, number>; final: { level: number; xp: number; cash: number; netWorth: number; buildings: number; zones: number; fields: number; producers: number; questIndex: number; repeatClaims: number; rate: number };
  daily: { day: number; level: number; cash: number; buildings: number; fields: number; rate: number }[];
  invariants: { snapshotValid: boolean; errors: string[]; walletSafe: boolean; occupancyValid: boolean };
  limitations: string[];
}

/** Strategies are observation/planning inputs. Every payment, yield, timer and reward comes from sim. */
export class EconomyBot {
  state: SimState;
  readonly schedule: Session[];
  readonly rejected: Record<string, number> = {};
  readonly levelAtDays: Record<number, number> = {};
  readonly daily: BotResult['daily'] = [];
  commands = 0; repeatClaims = 0; now = 0;
  private serial = 0;
  private siteCursor = new Map<string, number>();
  private noSpace = new Set<string>();
  private bridgeAttemptedMinute = -1;
  private farAnchor?: Cell;
  private bridgeCandidateCursor = 0;
  private reachableRevision = -1;
  private reachableRoad = new Set<number>();

  constructor(readonly template: WorldTemplate, readonly style: PlayStyle, readonly days: number, readonly onDay?: (day: number) => void) {
    this.schedule = sessions(style, days); this.now = this.schedule[0]!.start * MINUTE;
    this.state = createState(template, this.now, generateEnvironment(template)); recompute(this.state);
  }
  get s(): SimState { return this.state; }
  command<T extends CommandType>(type: T, payload: CommandPayload[T]): boolean {
    const result = execute(this.s, { type, payload, commandId: `ec000000-0000-4000-8000-${(++this.serial).toString(16).padStart(12, '0')}`,
      worldId: this.s.snapshot.worldId, expectedRevision: this.s.snapshot.revision, clientTime: this.now }, this.now);
    this.commands++;
    if (!result.result.accepted) { this.rejected[result.result.code] = (this.rejected[result.result.code] ?? 0) + 1; return false; }
    this.state = result.state; this.captureLevels(); return true;
  }
  captureLevels(): void {
    const elapsed = (this.now / MINUTE - this.schedule[0]!.start) / 1440;
    for (let level = 2; level <= this.s.snapshot.progress.level; level++) this.levelAtDays[level] ??= elapsed;
  }
  materials(cost: Cost, extraCash = 0): boolean {
    const wood = Math.max(0, cost.wood - this.s.snapshot.wallet.wood), stone = Math.max(0, cost.stone - this.s.snapshot.wallet.stone);
    if (this.s.snapshot.wallet.cash < cost.cash + wood * economy.materialPrices.wood + stone * economy.materialPrices.stone + extraCash) return false;
    return (!wood && !stone) || this.command('BUY_MATERIAL', { ...(wood ? { wood } : {}), ...(stone ? { stone } : {}) });
  }
  clear(cells: Cell[]): boolean {
    const ids = [...new Set(cells.map(cell => this.s.occupancy.get(cellIndex(...cell))).filter((id): id is string => id !== undefined))];
    if (ids.some(id => !this.s.env.some(env => env.id === id))) return false;
    return !ids.length || this.command('CLEAR_ENV', { envIds: ids });
  }
  free(cell: Cell, allowRoad = false): boolean {
    const index = cellIndex(...cell);
    return inBounds(cell) && isUnlocked(this.s, cell) && this.s.surface[index] !== Surface.WATER && this.s.surface[index] !== Surface.TILLED
      && (allowRoad || !this.s.roadTier[index]) && !(this.s.flags[index]! & (CellFlag.PROTECTED | CellFlag.NO_BUILD | CellFlag.ENTRY))
      && (!this.s.occupancy.has(index) || this.s.env.some(env => env.id === this.s.occupancy.get(index)));
  }
  pathTo(cells: Cell[]): Cell[] | undefined {
    const owned = new Set(cells.map(cell => cellIndex(...cell))), starts = cells.flatMap(cell => neighbors(cell)).filter(cell => !owned.has(cellIndex(...cell)));
    // Reject disconnected regions once per state revision instead of flood-filling every proposed lot.
    if (this.reachableRevision !== this.s.snapshot.revision) {
      this.reachableRevision = this.s.snapshot.revision; this.reachableRoad.clear();
      const reachable: Cell[] = [];
      for (let index = 0; index < this.s.connected.length; index++) if (this.s.connected[index]) {
        this.reachableRoad.add(index); reachable.push([index % 128, Math.floor(index / 128)]);
      }
      for (let head = 0; head < reachable.length; head++) for (const cell of neighbors(reachable[head]!)) {
        const index = cellIndex(...cell);
        if (this.reachableRoad.has(index) || !this.free(cell, true)) continue;
        this.reachableRoad.add(index); reachable.push(cell);
      }
    }
    if (!starts.some(cell => this.reachableRoad.has(cellIndex(...cell)))) return undefined;
    const previous = new Map<number, number>(), queue: Cell[] = [];
    for (const start of starts) if (this.free(start, true) || this.s.connected[cellIndex(...start)]) { previous.set(cellIndex(...start), -1); queue.push(start); }
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head]!, index = cellIndex(...cell);
      if (this.s.connected[index]) {
        const path: Cell[] = [];
        for (let cursor = index; cursor !== -1; cursor = previous.get(cursor)!) path.push([cursor % 128, Math.floor(cursor / 128)]);
        return path;
      }
      for (const next of neighbors(cell)) {
        const nextIndex = cellIndex(...next);
        if (previous.has(nextIndex) || owned.has(nextIndex) || (!this.free(next, true) && !this.s.connected[nextIndex])) continue;
        previous.set(nextIndex, index); queue.push(next);
      }
    }
    return undefined;
  }
  road(path: Cell[]): boolean {
    const missing = path.filter(cell => !this.s.roadTier[cellIndex(...cell)]);
    if (!missing.length) return true;
    if (!this.clear(missing)) return false;
    if (this.command('BUILD_ROAD', { tier: 1, cells: missing })) return true;
    // Follow the existing route one cell at a time; paid grading uses the same terrain tool as the player.
    for (const cell of missing) {
      if (!this.command('BUILD_ROAD', { tier: 1, cells: [cell] })) {
        const targetHDm = Math.round(meanHeight(this.s, cell) / economy.terraform.stepDm) * economy.terraform.stepDm;
        if (!this.command('TERRAFORM', { rect: [...cell, ...cell], mode: 'FLATTEN', targetHDm }) || !this.command('BUILD_ROAD', { tier: 1, cells: [cell] })) return false;
      }
    }
    return true;
  }
  expand(): boolean {
    const owned = new Set(this.s.snapshot.unlockedZones), entry = this.template.entryCells[0]!;
    const candidates = Array.from({ length: 64 }, (_, zone) => zone).filter(zone => !owned.has(zone)
      && [...owned].some(other => Math.abs(other % 8 - zone % 8) + Math.abs(Math.floor(other / 8) - Math.floor(zone / 8)) === 1));
    candidates.sort((a, b) => Math.hypot(a % 8 * 16 - entry[0], Math.floor(a / 8) * 16 - entry[1]) - Math.hypot(b % 8 * 16 - entry[0], Math.floor(b / 8) * 16 - entry[1]));
    for (const zone of candidates) if (this.command('UNLOCK_ZONE', { zoneId: zone })) { this.siteCursor.clear(); this.noSpace.clear(); return true; }
    return false;
  }
  build(defId: string, far = false): boolean {
    const def = catalog.buildings[defId]!, count = this.s.snapshot.buildings.filter(building => building.defId === defId).length;
    if (count >= buildingLimit(this.s, def) || this.s.snapshot.progress.level < (def.unlockLevels?.[count] ?? def.unlockLevel)
      || this.s.snapshot.buildings.filter(building => building.status === 'CONSTRUCTING').length >= builderCapacity(this.s)) return false;
    const cost = { ...def.cost, cash: def.costScaling?.[count] ?? def.cost.cash };
    if (this.s.snapshot.wallet.cash < costValue(cost)) return false;
    const entry = this.template.entryCells[0]!;
    const candidates: Cell[] = [];
    for (const zone of this.s.snapshot.unlockedZones) for (let z = Math.floor(zone / 8) * 16; z < Math.floor(zone / 8) * 16 + 16; z++) for (let x = zone % 8 * 16; x < zone % 8 * 16 + 16; x++) candidates.push([x, z]);
    candidates.sort((a, b) => Math.abs(a[0] - entry[0]) + Math.abs(a[1] - entry[1]) - Math.abs(b[0] - entry[0]) - Math.abs(b[1] - entry[1]));
    const start = this.siteCursor.get(defId) ?? 0;
    let plans = 0;
    for (let i = start; i < candidates.length; i++) {
      const anchor = candidates[i]!, cells = footprintCells(def, anchor, 0);
      if (cells.some(cell => !this.free(cell) || isShore(this.s, cell))) continue;
      if (far && !isFarBank(this.s, cells)) continue;
      const path = this.pathTo(cells);
      if (!path) continue;
      // Planning budget is a bot input: resume rejected legal-looking lots on the next observation.
      if (++plans > 16) { this.siteCursor.set(defId, i); return false; }
      // Keep construction affordable before paying for site preparation; margin is the real road cost.
      if (!this.materials(cost, path.length * economy.roadTiers[1].cost.cash)) return false;
      if (!this.clear(cells)) continue;
      const heights = [...new Set(cells.flatMap(cell => corners(cell)))].map(index => this.s.heights[index]!);
      if (Math.max(...heights) !== Math.min(...heights)) {
        const targetHDm = Math.round(heights.reduce((sum, height) => sum + height, 0) / heights.length / economy.terraform.stepDm) * economy.terraform.stepDm;
        if (!this.command('TERRAFORM', { rect: [anchor[0], anchor[1], anchor[0] + def.size[0] - 1, anchor[1] + def.size[1] - 1], mode: 'FLATTEN', targetHDm })) continue;
      }
      if (!this.road(path) || !this.command('PLACE_BUILDING', { defId, anchor, rotation: 0 })) continue;
      this.siteCursor.set(defId, i + 1); return true;
    }
    this.siteCursor.set(defId, candidates.length); this.noSpace.add(defId); return false;
  }
  claim(): void {
    const quest = catalog.quests[this.template.mapKind][this.s.snapshot.progress.questIndex];
    if (quest) {
      const progress = authoredQuestProgress(this.s);
      if (progress >= quest.target) this.command('CLAIM_QUEST', { questId: quest.id });
    }
    for (const repeat of [...(this.s.snapshot.progress.repeat?.active ?? [])]) {
      if (repeatQuestProgress(this.s, repeat) >= repeat.target && this.command('CLAIM_QUEST', { questId: repeat.id })) this.repeatClaims++;
    }
  }
  unlockCell(cell: Cell): boolean {
    const target = Math.floor(cell[1] / 16) * 8 + Math.floor(cell[0] / 16), owned = new Set(this.s.snapshot.unlockedZones);
    if (owned.has(target)) return true;
    const queue = [...owned], previous = new Map(queue.map(zone => [zone, -1]));
    for (let head = 0; head < queue.length && !previous.has(target); head++) {
      const zone = queue[head]!;
      for (const next of [zone % 8 ? zone - 1 : -1, zone % 8 < 7 ? zone + 1 : -1, zone - 8, zone + 8]) {
        if (next < 0 || next >= 64 || previous.has(next)) continue;
        previous.set(next, zone); queue.push(next);
      }
    }
    const path: number[] = [];
    for (let zone = target; !owned.has(zone); zone = previous.get(zone)!) path.push(zone);
    for (const zone of path.reverse()) if (!this.command('UNLOCK_ZONE', { zoneId: zone })) return false;
    this.siteCursor.clear(); this.noSpace.clear(); return true;
  }
  gradedRoad(path: Cell[], endHeight: number): boolean {
    if (!this.clear(path.filter(cell => !this.s.roadTier[cellIndex(...cell)]))) return false;
    const begin = Math.round(meanHeight(this.s, path[0]!) / economy.terraform.stepDm) * economy.terraform.stepDm;
    for (let index = 1; index < path.length; index++) {
      const cell = path[index]!;
      if (this.s.roadTier[cellIndex(...cell)]) continue;
      const targetHDm = Math.round((begin + (endHeight - begin) * index / (path.length - 1)) / economy.terraform.stepDm) * economy.terraform.stepDm;
      if (!this.command('TERRAFORM', { rect: [...cell, ...cell], mode: 'FLATTEN', targetHDm }) || !this.command('BUILD_ROAD', { tier: 1, cells: [cell] })) return false;
    }
    return true;
  }
  bridge(): void {
    if (this.s.snapshot.bridges.length || this.bridgeAttemptedMinute === this.now / MINUTE) return;
    this.bridgeAttemptedMinute = this.now / MINUTE;
    const def = catalog.bridges.bridge_wood!, entry = this.template.entryCells[0]!, candidates: { a: Cell; b: Cell; span: number; distance: number }[] = [];
    if (this.s.snapshot.progress.level < def.unlockLevel) return;
    const home = new Set<number>();
    if (this.template.bankRegions) {
      const region = this.template.bankRegions.find(item => item.cells.some(cell => cellIndex(...cell) === cellIndex(...entry)));
      for (const cell of region?.cells ?? []) home.add(cellIndex(...cell));
    } else {
      const queue = [entry]; home.add(cellIndex(...entry));
      for (let head = 0; head < queue.length; head++) for (const cell of neighbors(queue[head]!)) if (!home.has(cellIndex(...cell)) && this.s.surface[cellIndex(...cell)] !== Surface.WATER) { home.add(cellIndex(...cell)); queue.push(cell); }
    }
    for (let z = 1; z < 127; z++) for (let x = 1; x < 127; x++) {
      const first: Cell = [x, z];
      if (this.s.surface[cellIndex(...first)] === Surface.WATER || !isShore(this.s, first)) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]] as Cell[]) {
        let span = 0;
        while (span <= def.maxSpan && inBounds([x + dx * (span + 1), z + dz * (span + 1)]) && this.s.surface[cellIndex(x + dx * (span + 1), z + dz * (span + 1))] === Surface.WATER) span++;
        const second: Cell = [x + dx * (span + 1), z + dz * (span + 1)];
        if (!span || span > def.maxSpan || !inBounds(second)) continue;
        if (home.has(cellIndex(...first)) === home.has(cellIndex(...second))) continue;
        const all = [first, second, ...Array.from({ length: span }, (_, offset) => [x + dx * (offset + 1), z + dz * (offset + 1)] as Cell)];
        if (all.some(cell => this.s.flags[cellIndex(...cell)]! & (CellFlag.PROTECTED | CellFlag.NO_BUILD))) continue;
        const distance = (cell: Cell) => Math.abs(cell[0] - entry[0]) + Math.abs(cell[1] - entry[1]);
        const [a, b] = home.has(cellIndex(...first)) ? [first, second] : [second, first];
        candidates.push({ a: a!, b: b!, span, distance: distance(a!) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.span - b.span);
    const candidate = candidates[this.bridgeCandidateCursor++ % candidates.length];
    if (!candidate || !this.materials({ cash: def.costPerCell.cash * candidate.span, wood: def.costPerCell.wood * candidate.span, stone: def.costPerCell.stone * candidate.span })) return;
    if (!this.unlockCell(candidate.a) || !this.unlockCell(candidate.b)) return;
    const path = this.pathTo([candidate.a]);
    if (!path || !this.clear([candidate.a, candidate.b])) return;
    const bankHeight = this.template.waterLevelDm + economy.terraform.stepDm * 2;
    for (const bank of [candidate.a, candidate.b]) if (!this.s.roadTier[cellIndex(...bank)] && !this.command('TERRAFORM', { rect: [...bank, ...bank], mode: 'FLATTEN', targetHDm: bankHeight })) return;
    if (!this.gradedRoad([...path, candidate.a], bankHeight) || !this.command('BUILD_ROAD', { tier: 1, cells: [candidate.b] })) return;
    if (!this.materials({ cash: economy.embank.cost.cash * 2, wood: economy.embank.cost.wood * 2, stone: economy.embank.cost.stone * 2 })) return;
    if (!this.command('EMBANK', { cells: [candidate.a, candidate.b] })) return;
    if (this.command('BUILD_BRIDGE', { typeId: 'bridge_wood', a: candidate.a, b: candidate.b })) this.farAnchor = candidate.b;
  }
  infrastructure(): void {
    const quest = catalog.quests[this.template.mapKind][this.s.snapshot.progress.questIndex];
    if (!quest) return;
    if (quest.action === 'UNLOCK_ZONE') this.expand();
    if (quest.action === 'EMBANK') {
      const cells: Cell[] = [];
      for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
        const cell: Cell = [x, z], index = cellIndex(x, z);
        if (isUnlocked(this.s, cell) && isShore(this.s, cell) && !(this.s.flags[index]! & (CellFlag.PROTECTED | CellFlag.EMBANKED))
          && !this.s.occupancy.has(index)) cells.push(cell);
      }
      if (cells.length >= quest.target && this.materials({ cash: economy.embank.cost.cash * quest.target, wood: economy.embank.cost.wood * quest.target, stone: economy.embank.cost.stone * quest.target })) this.command('EMBANK', { cells: cells.slice(0, quest.target) });
      else if (cells.length < quest.target) {
        const shore: Cell[] = [];
        for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) if (isShore(this.s, [x, z]) && !(this.s.flags[cellIndex(x, z)]! & (CellFlag.PROTECTED | CellFlag.NO_BUILD))) shore.push([x, z]);
        const entry = this.template.entryCells[0]!;
        shore.sort((a, b) => Math.abs(a[0] - entry[0]) + Math.abs(a[1] - entry[1]) - Math.abs(b[0] - entry[0]) - Math.abs(b[1] - entry[1]));
        const next = shore.find(cell => !isUnlocked(this.s, cell)); if (next) this.unlockCell(next);
      }
    }
    if (quest.action === 'BRIDGE') this.bridge();
    if (quest.farBank && this.s.snapshot.bridges.some(bridge => bridge.status === 'ACTIVE')) {
      if (this.template.mapKind === 'city') {
        const def = Object.values(catalog.buildings).find(building => building.mapKinds.includes('city') && building.baseRatePerHour && building.unlockLevel <= this.s.snapshot.progress.level
          && this.s.snapshot.buildings.filter(item => item.defId === building.id).length < buildingLimit(this.s, building));
        if (def) { this.siteCursor.delete(def.id); this.build(def.id, true); }
      } else if (this.farAnchor) {
        const targets: Cell[] = [];
        for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
          const cell: Cell = [this.farAnchor[0] + dx, this.farAnchor[1] + dz];
          if (this.free(cell) && slope(this.s, cell) <= economy.terraform.stepDm && isFarBank(this.s, [cell])) targets.push(cell);
        }
        if (targets.length) {
          const available = this.s.surface.findIndex((surface, index) => surface === Surface.TILLED && !this.s.occupancy.has(index));
          if (available >= 0) this.command('UNTILL', { rect: [available % 128, Math.floor(available / 128), available % 128, Math.floor(available / 128)] });
          for (const cell of targets) if (this.clear([cell]) && this.command('TILL', { rect: [...cell, ...cell] })) break;
        }
      }
    }
    this.claim();
  }
  city(): void {
    const ids = this.s.snapshot.buildings.filter(building => building.status === 'ACTIVE' && (building.accrued ?? 0) >= 1).map(building => building.id);
    if (ids.length) this.command('COLLECT', { buildingIds: ids });
    const quest = catalog.quests.city[this.s.snapshot.progress.questIndex];
    if (!this.s.snapshot.progress.tutorialDone && quest?.action !== 'BUILD') return;
    if (quest?.buildingId && this.build(quest.buildingId)) this.claim();
    if (!this.s.snapshot.progress.tutorialDone) return;
    const population = this.s.snapshot.buildings.reduce((sum, building) => sum + (catalog.buildings[building.defId]!.population ?? 0), 0);
    const jobs = this.s.snapshot.buildings.reduce((sum, building) => sum + (catalog.buildings[building.defId]!.jobs ?? 0), 0);
    const total = Object.values(this.s.rates).reduce((sum, rate) => sum + rate, 0), work = jobs ? Math.min(1, population / jobs) : 1;
    const business = this.s.snapshot.buildings.reduce((sum, building) => sum + (catalog.buildings[building.defId]!.jobs ? catalog.buildings[building.defId]!.baseRatePerHour ?? 0 : 0), 0);
    const capture = (hours: number): number => {
      const calendar = sessions(this.style, 2).filter(session => session.day === 2);
      let captured = 0;
      for (let i = 0; i < calendar.length; i++) {
        const current = calendar[i]!, next = calendar[(i + 1) % calendar.length]!.start + (i === calendar.length - 1 ? 1440 : 0);
        captured += current.end - current.start + Math.min(next - current.end, hours * 60);
      }
      return Math.min(1, captured / 1440);
    };
    const oldCap = capHours(this.s), before = capture(oldCap);
    const options = Object.values(catalog.buildings).filter(def => def.mapKinds.includes('city') && def.unlockLevel <= this.s.snapshot.progress.level)
      .map(def => {
        const efficiency = jobs + (def.jobs ?? 0) ? Math.min(1, (population + (def.population ?? 0)) / (jobs + (def.jobs ?? 0))) : 1;
        const delta = (def.baseRatePerHour ?? 0) * (def.jobs ? efficiency : 1) + business * (efficiency - work)
          + (def.decor ? total * Math.min(economy.income.decorCap, def.decor.bonus) : 0);
        const score = ((total + delta) * capture(oldCap + (def.bankCapHours ?? 0)) - total * before) / costValue(def.cost);
        return { def, score };
      })
      .sort((a, b) => b.score - a.score);
    for (const option of options) if (option.score > 0 && this.build(option.def.id)) return;
    if (this.noSpace.size && this.s.snapshot.wallet.cash > economy.zones.costBase) this.expand();
  }
  sellAll(): void {
    const reserve: Record<string, number> = {};
    // Bot strategy: keep one input batch per owned recipe, never buy unavailable farm products.
    for (const building of this.s.snapshot.buildings) if (building.status === 'ACTIVE') for (const id of catalog.buildings[building.defId]!.production?.recipes ?? []) {
      for (const [item, amount] of Object.entries(catalog.recipes[id]!.inputs)) reserve[item] = Math.max(reserve[item] ?? 0, amount);
    }
    const items = Object.fromEntries(Object.entries(this.s.snapshot.inventory).map(([id, count]) => [id, Math.max(0, count - (reserve[id] ?? 0))]).filter(([, count]) => Number(count) > 0));
    if (Object.keys(items).length) this.command('SELL', { items });
  }
  production(): void {
    for (const building of [...this.s.snapshot.buildings]) if (building.status === 'ACTIVE' && building.slots?.some(slot => slot[0] && slot[0].readyAt <= this.now)) this.command('COLLECT_PRODUCTION', { buildingId: building.id });
    for (const building of [...this.s.snapshot.buildings]) {
      const producer = catalog.buildings[building.defId]!.production;
      if (!producer || building.status !== 'ACTIVE' || !access(this.s, building)) continue;
      for (const recipeId of producer.recipes) {
        const current = this.s.snapshot.buildings.find(item => item.id === building.id)!;
        const room = producer.slots * producer.queueLimit - (current.slots ?? []).reduce((sum, slot) => sum + slot.length, 0);
        const count = Math.min(room, ...Object.entries(catalog.recipes[recipeId]!.inputs).map(([id, units]) => Math.floor((this.s.snapshot.inventory[id] ?? 0) / units)));
        if (count > 0) this.command('START_PRODUCTION', { buildingId: building.id, recipeId, count });
      }
    }
  }
  productionCrop(): string | undefined {
    const wanted: Record<string, number> = {};
    for (const building of this.s.snapshot.buildings) if (building.status === 'ACTIVE') {
      const producer = catalog.buildings[building.defId]!.production;
      if (!producer) continue;
      const room = producer.slots * producer.queueLimit - (building.slots ?? []).reduce((sum, slot) => sum + slot.length, 0);
      for (const recipeId of producer.recipes) for (const [id, count] of Object.entries(catalog.recipes[recipeId]!.inputs)) wanted[id] = (wanted[id] ?? 0) + room * count;
    }
    for (const crop of this.s.snapshot.crops) wanted[catalog.crops[crop.cropId]!.itemId] = (wanted[catalog.crops[crop.cropId]!.itemId] ?? 0) - catalog.crops[crop.cropId]!.yield;
    return Object.entries(wanted).sort((a, b) => b[1] - a[1]).find(([id, count]) => {
      const crop = catalog.crops[id];
      return crop !== undefined && count > (this.s.snapshot.inventory[id] ?? 0) && crop.unlockLevel <= this.s.snapshot.progress.level;
    })?.[0];
  }
  fields(): void {
    const room = fieldQuota(this.s) - this.s.surface.reduce((sum, surface) => sum + Number(surface === Surface.TILLED), 0);
    if (room <= 0 || this.s.snapshot.wallet.cash < room * economy.till.cost) return;
    const choices: Cell[] = [];
    for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) if (this.free([x, z]) && slope(this.s, [x, z]) <= economy.terraform.stepDm) choices.push([x, z]);
    const entry = this.template.entryCells[0]!;
    choices.sort((a, b) => Math.abs(a[0] - entry[0]) + Math.abs(a[1] - entry[1]) - Math.abs(b[0] - entry[0]) - Math.abs(b[1] - entry[1]));
    let remaining = room;
    for (const cell of choices) {
      if (!remaining) break;
      if (!this.free(cell)) continue;
      const run: Cell[] = [cell];
      while (run.length < remaining && run.length < 16) {
        const next: Cell = [cell[0] + run.length, cell[1]];
        if (!this.free(next) || slope(this.s, next) > economy.terraform.stepDm) break;
        run.push(next);
      }
      if (this.clear(run) && this.command('TILL', { rect: [cell[0], cell[1], run.at(-1)![0], cell[1]] })) remaining -= run.length;
    }
  }
  farm(session: Session, minute: number): void {
    if (!this.s.snapshot.buildings.some(building => building.defId === 'market')) { this.build('market'); return; }
    if (!this.s.snapshot.buildings.some(building => building.defId === 'farmhouse')) { this.build('farmhouse'); return; }
    // Real storage limits: harvest batches, sell to make room, then continue. No purchased crop inputs.
    const ripe = this.s.snapshot.crops.filter(crop => crop.readyAt <= this.now).map(crop => crop.cell);
    for (let i = 0; i < ripe.length; i += 256) { if (this.command('HARVEST', { cells: ripe.slice(i, i + 256) })) { this.production(); this.sellAll(); } }
    this.production(); this.sellAll(); this.claim(); this.infrastructure();
    const quest = catalog.quests.farm[this.s.snapshot.progress.questIndex];
    if (quest?.buildingId) this.build(quest.buildingId);
    this.fields(); this.claim();
    const free: Cell[] = [];
    for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) if (this.s.surface[cellIndex(x, z)] === Surface.TILLED && !this.s.occupancy.has(cellIndex(x, z))) free.push([x, z]);
    const available = Object.values(catalog.crops).filter(crop => crop.unlockLevel <= this.s.snapshot.progress.level);
    const neededCrop = this.productionCrop();
    const preferred = quest?.action === 'PLANT' && quest.cropId ? catalog.crops[quest.cropId] : neededCrop ? catalog.crops[neededCrop] : undefined;
    const crop = preferred ?? available.sort((a, b) => {
      const profit = (def: typeof a) => ((catalog.items[def.itemId]!.sellPrice * def.yield - def.seedCost)
        / Math.max(1, nextHarvestMinute(minute + def.growSeconds / 60, this.schedule) - minute));
      return profit(b) - profit(a);
    })[0]!;
    for (let i = 0; i < free.length;) {
      const first = free[i]!, row: Cell[] = [first]; i++;
      while (i < free.length && free[i]![1] === first[1] && free[i]![0] === row.at(-1)![0] + 1) row.push(free[i++]!);
      if (this.s.snapshot.wallet.cash >= row.length * crop.seedCost) this.command('PLANT', { rect: [first[0], first[1], row.at(-1)![0], first[1]], cropId: crop.id });
    }
    if (this.s.snapshot.buildings.filter(building => building.defId === 'farmhouse').length < (catalog.buildings.farmhouse!.unlockLevels?.filter(level => level <= this.s.snapshot.progress.level).length ?? 0)) this.build('farmhouse');
    if (!this.s.snapshot.buildings.some(building => building.defId === 'well') && this.s.snapshot.progress.level >= catalog.buildings.well!.unlockLevel) this.build('well');
    const producers = Object.values(catalog.buildings).filter(def => def.mapKinds.includes('farm') && def.production && def.unlockLevel <= this.s.snapshot.progress.level)
      .map(def => ({ def, score: def.production!.slots * Math.max(...def.production!.recipes.map(id => {
        const recipe = catalog.recipes[id]!;
        return (catalog.items[recipe.output]!.sellPrice - Object.entries(recipe.inputs).reduce((sum, [item, count]) => sum + catalog.items[item]!.sellPrice * count, 0)) / (recipe.seconds / 3600);
      })) / costValue(def.cost) })).sort((a, b) => b.score - a.score);
    for (const { def } of producers) if (this.build(def.id)) break;
    if (this.s.snapshot.inventory && this.s.snapshot.progress.level >= catalog.buildings.silo!.unlockLevel
      && !this.s.snapshot.buildings.some(building => building.defId === 'silo') && this.s.snapshot.crops.length * Math.max(...available.map(def => def.yield)) > economy.farm.baseStorage) this.build('silo');
    if (this.noSpace.size) this.expand();
    if (session.end === minute) this.claim();
  }
  run(): BotResult {
    for (let index = 0; index < this.schedule.length; index++) {
      const session = this.schedule[index]!;
      for (let minute = session.start; minute <= session.end; minute++) {
        this.now = minute * MINUTE; advanceTime(this.s, this.now); this.captureLevels();
        const quest = catalog.quests[this.template.mapKind][this.s.snapshot.progress.questIndex];
        if (this.template.mapKind === 'city') {
          if (quest?.action === 'CLEAR') this.command('CLEAR_ENV', { envIds: this.s.env.filter(env => env.assetId.startsWith('tree') && isUnlocked(this.s, env.cell) && !this.s.snapshot.delta.removedEnvIds.includes(env.id)).slice(0, quest.target).map(env => env.id) });
          if (quest?.action === 'ROAD') {
            const [x, z] = this.template.entryCells[0]!;
            this.road(Array.from({ length: quest.target + 1 }, (_, offset) => [x + offset, z]));
          }
          if (quest?.action === 'TERRAFORM') {
            const lot = this.template.suggestedLots?.[0];
            if (lot && this.clear(footprintCells({ size: [2, 2] }, [lot.cells[0], lot.cells[1]], 0))) this.command('TERRAFORM', { rect: [lot.cells[0], lot.cells[1], lot.cells[0] + 1, lot.cells[1] + 1], mode: 'FLATTEN' });
          }
          this.claim();
          if ((minute - session.start) % 5 === 0 || minute === session.end || !this.s.snapshot.progress.tutorialDone) this.city();
          this.infrastructure();
        } else this.farm(session, minute);
        this.claim();
      }
      if (this.schedule[index + 1]?.day !== session.day) this.daily.push({ day: session.day, level: this.s.snapshot.progress.level, cash: this.s.snapshot.wallet.cash,
        buildings: this.s.snapshot.buildings.length, fields: this.s.surface.reduce((sum, surface) => sum + Number(surface === Surface.TILLED), 0), rate: Object.values(this.s.rates).reduce((sum, rate) => sum + rate, 0) });
      if (this.schedule[index + 1]?.day !== session.day) this.onDay?.(session.day);
    }
    recompute(this.s); rebuildOccupancy(this.s);
    const snapshot = validateSnapshot(this.s, this.s.snapshot, this.now), occupancy = rebuildOccupancy(this.s);
    return { mapKind: this.template.mapKind, style: this.style, days: this.days, templateId: this.template.mapId, templateVersion: this.template.templateVersion,
      firstMinute: this.schedule[0]!.start, levelAtDays: this.levelAtDays, commands: this.commands, rejected: this.rejected, daily: this.daily,
      final: { level: this.s.snapshot.progress.level, xp: this.s.snapshot.progress.xp, cash: this.s.snapshot.wallet.cash, netWorth: this.s.snapshot.character.netWorth,
        buildings: this.s.snapshot.buildings.length, zones: this.s.snapshot.unlockedZones.length, fields: this.s.surface.reduce((sum, surface) => sum + Number(surface === Surface.TILLED), 0),
        producers: this.s.snapshot.buildings.filter(building => catalog.buildings[building.defId]!.production).length, questIndex: this.s.snapshot.progress.questIndex, repeatClaims: this.repeatClaims,
        rate: Object.values(this.s.rates).reduce((sum, rate) => sum + rate, 0) },
      invariants: { snapshotValid: snapshot.ok, errors: snapshot.ok ? [] : snapshot.errors, walletSafe: Object.values(this.s.snapshot.wallet).every(value => Number.isSafeInteger(value) && value >= 0), occupancyValid: !occupancy.length },
      limitations: ['Bot strategy is an input, not proof of optimal player progression.', 'Production inputs must be grown; reference-model purchases at sell price are not permitted commands.',
        'Infrastructure uses paid legal commands; failed bridge-site planning is reported, never replaced with virtual quest completion.', 'No geometry-free overhead payment, virtual construction XP, crop sales outside market access, or injected quest rewards.'] };
  }
}
