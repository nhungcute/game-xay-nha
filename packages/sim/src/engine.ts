import { CellFlag, CommandSchema, Surface, WorldSnapshotSchema, cellIndex, decodeInt16, decodeUint8, encodeInt16, encodeUint8, vertIndex, type Command, type CommandResult, type Cost, type ErrorCode, type GameEvent, type StatePatch, type ZoneDelta } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { RuleError, addCost, addXp, cashXp, event, guard, pay, refund, requireEditable, requireLevel, zeroCost } from './common';
import { construction } from './construction';
import { farm } from './farm';
import { terrain } from './terrain';
import { advanceTime, populationAndJobs, recompute } from './economy';
import { access } from './roads';
import { claimRepeat, ensureRepeatQuests, rerollRepeat } from './quests';
import { claimRelief } from './upgrades';
import { cloneState, rebuildOccupancy, writeDeltas, type SimState } from './state';

export interface Execution { state: SimState; result: CommandResult; cost: Cost; dirtyZones: number[] }

function administrative(s: SimState, cmd: Command, now: number): Cost | undefined {
  if (cmd.type === 'CLEAR_ENV') {
    let cost = zeroCost(), reward = zeroCost(), area = 0;
    const cleared: {id:string;kind:string}[] = [];
    for (const id of cmd.payload.envIds) {
      const obj = s.env.find(e => e.id === id && !s.snapshot.delta.removedEnvIds.includes(id));
      guard(obj,'NOT_FOUND'); area += obj.footprint ** 2; guard(area <= 256,'AREA_TOO_LARGE');
      for (let z=0;z<obj.footprint;z++) for (let x=0;x<obj.footprint;x++) requireEditable(s,[obj.cell[0]+x,obj.cell[1]+z]);
      const category = s.template.env.scatter.find(spec => spec.assetIds.includes(obj.assetId))?.category ?? obj.assetId;
      const kind = category.startsWith('tree') ? 'tree' : category.startsWith('rock_large') ? 'rock_large' : category.startsWith('rock') ? 'rock' : 'bush';
      const def = economy.clear[kind]; cost = addCost(cost,def.cost); reward = addCost(reward,def.reward); cleared.push({id,kind});
    }
    pay(s,cost,true); refund(s,reward);
    for (const c of cleared) { s.snapshot.delta.removedEnvIds.push(c.id); event(s,'CLEAR',c.kind); }
    return cost;
  }
  if (cmd.type === 'BUY_MATERIAL') {
    const {wood=0,stone=0} = cmd.payload;
    const cost = {...zeroCost(),cash:wood*economy.materialPrices.wood+stone*economy.materialPrices.stone};
    pay(s,cost); s.snapshot.wallet.wood+=wood; s.snapshot.wallet.stone+=stone; return cost;
  }
  if (cmd.type === 'UNLOCK_ZONE') {
    const {zoneId} = cmd.payload, owned = s.snapshot.unlockedZones;
    guard(!owned.includes(zoneId),'ZONE_LOCKED');
    const k = owned.length-s.template.startZones.length, def = economy.zones;
    guard(k < def.maxBuy,'LIMIT_REACHED');
    requireLevel(s,Math.min(def.unlockMax,def.unlockBase+Math.floor(k/def.unlockEvery)));
    const x = zoneId%8,z=Math.floor(zoneId/8);
    guard(owned.some(id => Math.abs(id%8-x)+Math.abs(Math.floor(id/8)-z)===1),'ZONE_LOCKED');
    let water = 0;
    for (let dz=0;dz<16;dz++) for (let dx=0;dx<16;dx++) water += Number(s.surface[cellIndex(x*16+dx,z*16+dz)]===Surface.WATER);
    const cost = {...zeroCost(),cash:Math.floor((def.costBase+def.costLinear*k+def.costQuadratic*k*k)*(water/256>def.waterThreshold ? def.waterPriceMultiplier:1))};
    pay(s,cost); owned.push(zoneId); owned.sort((a,b)=>a-b); s.snapshot.landValue+=cost.cash;
    // Natural road protection outside unlocked land is released on purchase; landmarks stay protected.
    for (let dz=0;dz<16;dz++) for (let dx=0;dx<16;dx++) {
      const i=cellIndex(x*16+dx,z*16+dz);
      if (s.baseRoadTier[i] && (s.flags[i]! & CellFlag.PROTECTED) && !(s.flags[i]! & CellFlag.NO_BUILD)) s.flags[i]=s.flags[i]! & ~CellFlag.PROTECTED;
    }
    event(s,'UNLOCK_ZONE','zone'); return cost;
  }
  if (cmd.type === 'COLLECT') {
    guard(s.template.mapKind === 'city','WRONG_MAP');
    let ids = cmd.payload.buildingIds;
    // D028: "collect all" (empty list) no longer needs a bank.
    if (!ids.length) {
      ids = s.snapshot.buildings.filter(b=>b.status==='ACTIVE' && catalog.buildings[b.defId]?.baseRatePerHour).map(b=>b.id);
    }
    let collected=0;
    for (const id of ids) {
      const b=s.snapshot.buildings.find(b=>b.id===id); guard(b,'BUILDING_NOT_FOUND');
      guard(b.status==='ACTIVE','UNDER_CONSTRUCTION');
      guard(catalog.buildings[b.defId]?.baseRatePerHour,'CELL_BLOCKED');
      const amount=Math.floor(b.accrued ?? 0); b.accrued=(b.accrued ?? 0)-amount; collected+=amount;
    }
    s.snapshot.wallet.cash+=collected; cashXp(s,collected,'collect');
    if (collected) { event(s,'COLLECT','first_collection'); event(s,'COLLECT','cash',collected); }
    return zeroCost();
  }
  if (cmd.type === 'REROLL_QUEST') return rerollRepeat(s,cmd.payload.questId,now);
  if (cmd.type === 'CLAIM_QUEST') {
    const repeat=claimRepeat(s,cmd.payload.questId); if (repeat) return repeat;
    const p=s.snapshot.progress, q=catalog.quests[s.template.mapKind][p.questIndex];
    guard(q?.id===cmd.payload.questId,'NOT_FOUND');
    guard(authoredQuestProgress(s)>=q.target,'QUEST_NOT_READY');
    refund(s,q.reward); addXp(s,q.xp); p.questIndex++;
    if (p.questIndex >= economy.construction.tutorialInstantThroughQuest) p.tutorialDone=true;
    ensureRepeatQuests(s);
    return zeroCost();
  }
  return undefined;
}

/**
 * Progress of the current authored quest. Quests about the world's state (roads, embankments, tilled
 * cells, buildings, population) are measured from the state itself, so work done before the quest
 * appeared still counts and a player can never get stuck (G3 sim-economy finding). Action quests
 * (clear, flatten, plant, harvest, sell, collect, produce, bridge, zones) count events while active.
 */
export function authoredQuestProgress(s: SimState): number {
  const p=s.snapshot.progress, q=catalog.quests[s.template.mapKind][p.questIndex];
  if (!q) return 0;
  if (q.action==='BUILD' && q.buildingId) return s.snapshot.buildings.filter(b=>b.defId===q.buildingId && b.status==='ACTIVE' && (!q.requiresRoad || access(s,b))).length;
  if (q.action==='POPULATION') return populationAndJobs(s).population;
  let count=0;
  if (q.action==='ROAD') { for (let i=0;i<s.roadTier.length;i++) if (s.roadTier[i] && !s.baseRoadTier[i]) count++; return count; }
  if (q.action==='EMBANK') { for (let i=0;i<s.flags.length;i++) if (s.flags[i]! & CellFlag.EMBANKED) count++; return count; }
  if (q.action==='TILL' && q.kind==='cells') { for (let i=0;i<s.surface.length;i++) if (s.surface[i]===Surface.TILLED) count++; return count; }
  return p.questProgress[q.id] ?? 0;
}

function applyDraft(s: SimState, cmd: Command, now: number): Cost {
  advanceTime(s,now);
  const cost = terrain(s,cmd) ?? construction(s,cmd,now) ?? farm(s,cmd,now) ?? claimRelief(s,cmd,now) ?? administrative(s,cmd,now);
  guard(cost!==undefined,'INVALID_COMMAND');
  guard(rebuildOccupancy(s).length===0,'OCCUPIED'); recompute(s);
  if (cmd.type==='BUILD_ROAD') {
    const q=catalog.quests[s.template.mapKind][s.snapshot.progress.questIndex];
    if (q?.action==='ROAD') {
      for (const c of cmd.payload.cells) if (s.connected[cellIndex(...c)]) s.snapshot.progress.questProgress[`road_${cellIndex(...c)}`]=1;
      s.snapshot.progress.questProgress[q.id]=Object.entries(s.snapshot.progress.questProgress).filter(([k])=>k.startsWith('road_')).reduce((sum,[,n])=>sum+n,0);
    }
  }
  s.snapshot.revision++; return cost;
}

function rejection(s: SimState, input: unknown, code: ErrorCode, detail?: unknown): Execution {
  const id = typeof input==='object' && input!==null && 'commandId' in input && typeof input.commandId==='string' ? input.commandId : '';
  return {state:s,result:{accepted:false,commandId:id,code,detail,revision:s.snapshot.revision,serverTime:s.snapshot.serverTime},cost:zeroCost(),dirtyZones:[]};
}
function gameEvents(before: SimState, after: SimState, cmd: Command): GameEvent[] {
  const events: GameEvent[]=[];
  for (let l=before.snapshot.progress.level+1;l<=after.snapshot.progress.level;l++) events.push({type:'LEVEL_UP',level:l});
  if (cmd.type==='CLAIM_QUEST') events.push({type:'QUEST_COMPLETED',questId:cmd.payload.questId});
  if (cmd.type==='UNLOCK_ZONE') events.push({type:'UNLOCK',unlockIds:[String(cmd.payload.zoneId)]});
  return events;
}
function patch(before: SimState, s: SimState, dirty: number[]): StatePatch {
  const zones:Record<number,ZoneDelta>={};
  for (const id of dirty) {
    const delta=s.snapshot.delta.zones[String(id)];
    if (delta) { zones[id]=delta; continue; }
    // A reverted chunk still needs its effective base values in the render patch.
    const ox=id%8*16,oz=Math.floor(id/8)*16;
    const sourceH=decodeInt16(s.template.layers.heightsDm,129*129),sourceS=decodeUint8(s.template.layers.surface,128*128),sourceF=decodeUint8(s.template.layers.flags,128*128),sourceR=s.baseRoadTier;
    const hs=new Int16Array(289),surface=new Uint8Array(256),flags=new Uint8Array(256),roads=new Uint8Array(256);
    for (let z=0;z<=16;z++) for (let x=0;x<=16;x++) hs[z*17+x]=sourceH[vertIndex(ox+x,oz+z)]!;
    for (let z=0;z<16;z++) for (let x=0;x<16;x++) {
      const i=cellIndex(ox+x,oz+z),j=z*16+x; surface[j]=sourceS[i]!;flags[j]=sourceF[i]!;roads[j]=sourceR[i]!;
    }
    zones[id]={heightsDm:encodeInt16(hs),surface:encodeUint8(surface),flags:encodeUint8(flags),roadTier:encodeUint8(roads)};
  }
  return {
    wallet:s.snapshot.wallet,progress:s.snapshot.progress,
    character:s.snapshot.character,unlockedZones:s.snapshot.unlockedZones,landValue:s.snapshot.landValue,
    zones,
    buildings:{upsert:s.snapshot.buildings,remove:before.snapshot.buildings.filter(b=>!s.snapshot.buildings.some(n=>n.id===b.id)).map(b=>b.id)},
    bridges:{upsert:s.snapshot.bridges,remove:before.snapshot.bridges.filter(b=>!s.snapshot.bridges.some(n=>n.id===b.id)).map(b=>b.id)},
    crops:s.snapshot.crops,inventory:s.snapshot.inventory,
    removedEnvIds:s.snapshot.delta.removedEnvIds.filter(id=>!before.snapshot.delta.removedEnvIds.includes(id)),
  };
}
/** Atomic: an error returns the original state; no mutation reaches callers. */
export function execute(s: SimState, input: unknown, now: number): Execution {
  const parsed=CommandSchema.safeParse(input);
  if (!parsed.success) {
    const oversized=parsed.error.issues.some(i=>i.message.includes('256'));
    return rejection(s,input,oversized?'AREA_TOO_LARGE':'INVALID_COMMAND',parsed.error.issues);
  }
  const cmd=parsed.data;
  if (cmd.worldId!==s.snapshot.worldId) return rejection(s,cmd,'INVALID_COMMAND');
  if (cmd.expectedRevision!==s.snapshot.revision) return rejection(s,cmd,'REVISION_CONFLICT');
  const draft=cloneState(s);
  try {
    const cost=applyDraft(draft,cmd,now);
    // Low decorative grass disappears only when its cell surface changes.
    for (const obj of draft.env) if (!obj.blocking && draft.surface[cellIndex(...obj.cell)]!==s.surface[cellIndex(...obj.cell)] && !draft.snapshot.delta.removedEnvIds.includes(obj.id)) draft.snapshot.delta.removedEnvIds.push(obj.id);
    const dirtyZones=writeDeltas(draft); recompute(draft);
    guard(WorldSnapshotSchema.safeParse(draft.snapshot).success,'INVALID_COMMAND');
    return {state:draft,cost,dirtyZones,result:{accepted:true,commandId:cmd.commandId,revision:draft.snapshot.revision,serverTime:now,patch:patch(s,draft,dirtyZones),events:gameEvents(s,draft,cmd)}};
  } catch (error) {
    if (error instanceof RuleError) return rejection(s,cmd,error.code,error.message);
    throw error;
  }
}
export function validate(s: SimState, input: unknown, now: number): {valid:true;cost:Cost;dirtyZones:number[]}|{valid:false;code:ErrorCode;detail?:unknown} {
  const e=execute(s,input,now);
  return e.result.accepted ? {valid:true,cost:e.cost,dirtyZones:e.dirtyZones} : {valid:false,code:e.result.code,detail:e.result.detail};
}
export const previewCost = validate;
export const apply = execute;

function copyResult(result: CommandResult): CommandResult {
  return JSON.parse(JSON.stringify(result)) as CommandResult;
}

/** In-memory adapter for offline G1; G2 persists this ledger in world_commands. */
export class SimSession {
  private readonly results=new Map<string,CommandResult>();
  constructor(public state:SimState) {}
  execute(input:unknown,now:number):CommandResult {
    const id=typeof input==='object' && input!==null && 'commandId' in input && typeof input.commandId==='string' ? input.commandId : undefined;
    if (id && this.results.has(id)) return copyResult(this.results.get(id)!);
    const execution=execute(this.state,input,now); this.state=execution.state;
    if (id) this.results.set(id,copyResult(execution.result));
    return copyResult(execution.result);
  }
}
