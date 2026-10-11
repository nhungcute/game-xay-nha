import { expect, it } from 'vitest';
import { Surface, type Cell, type Command, type MapKind } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate, mulberry32 } from '@xay-nha/worldgen';
import { createState, cloneState, rebuildOccupancy, type SimState } from './state';
import { execute } from './engine';
import { validateSnapshot, stateHash } from './snapshot';

it('1000 seeded random commands preserve occupancy, integer wallet, unique IDs and all shared edges',()=>{
  const rng=mulberry32(20261009), pick=<T>(values:T[]):T=>values[Math.floor(rng()*values.length)]!;
  let serial=0, accepted=0, rejected=0;
  const types=new Set<string>();
  for (const kind of ['city','farm'] as MapKind[]) {
    let now=1_000_000,s:SimState=createState(createTestTemplate(kind),now);
    s.snapshot.wallet={cash:100_000_000,wood:50_000,stone:50_000};
    s.snapshot.progress.level=20;s.snapshot.progress.xp=economy.xp.cumulative[kind][20]!;
    s.snapshot.progress.questIndex=12;s.snapshot.progress.tutorialDone=true;
    const run=(type:Command['type'],payload:unknown,mustPass=false):void=>{
      serial++;
      const before=stateHash(s), previous=s;
      const e=execute(s,{type,payload,commandId:`00000000-0000-4000-8000-${serial.toString(16).padStart(12,'0')}`,
        worldId:s.snapshot.worldId,expectedRevision:s.snapshot.revision,clientTime:now},now);
      if (mustPass) expect(e.result,JSON.stringify({type,payload,result:e.result})).toMatchObject({accepted:true});
      if (e.result.accepted) { s=e.state; if(!mustPass) accepted++; }
      else { if(!mustPass) rejected++;expect(e.state).toBe(previous);expect(stateHash(s)).toBe(before); }
      const copy=cloneState(s);expect(rebuildOccupancy(copy)).toEqual([]);expect(copy.occupancy).toEqual(s.occupancy);
      expect(Object.values(s.snapshot.wallet).every(v=>Number.isSafeInteger(v)&&v>=0)).toBe(true);
      const ids=[...s.snapshot.buildings,...s.snapshot.bridges].map(b=>b.id);expect(new Set(ids).size).toBe(ids.length);
      const load=validateSnapshot(s,s.snapshot,now);
      expect(load,JSON.stringify({type,payload})).toMatchObject({ok:true});
    };
    if (kind==='farm') {
      // Real fixture river, roads, both embanked banks, timed bridge and connected support buildings.
      run('TERRAFORM',{rect:[57,73,59,75],mode:'FLATTEN',targetHDm:35},true);
      run('TERRAFORM',{rect:[64,73,66,75],mode:'FLATTEN',targetHDm:35},true);
      for (const [x,h] of [[67,40],[68,45],[69,50]]) run('TERRAFORM',{rect:[x,73,x,75],mode:'FLATTEN',targetHDm:h},true);
      run('BUILD_ROAD',{tier:1,cells:[[70,78],[70,77],[70,76],[70,75],[70,74],[69,74],[68,74],[67,74],[66,74],[65,74],[64,74]]},true);
      run('BUILD_ROAD',{tier:1,cells:[[59,74]]},true);
      run('EMBANK',{cells:[[59,74],[64,74]]},true);
      run('BUILD_BRIDGE',{typeId:'bridge_wood',a:[59,74],b:[64,74]},true);
      now+=4*60_000;
      run('BUILD_ROAD',{tier:1,cells:[[65,73]]},true);
      run('PLACE_BUILDING',{defId:'farmhouse',anchor:[65,70],rotation:0,autoFlattenHDm:35},true);
      run('PLACE_BUILDING',{defId:'market',anchor:[69,70],rotation:0,autoFlattenHDm:50},true);
      now+=60_000;
      run('BUILD_ROAD',{tier:1,cells:[[69,73]]},true);
      run('TILL',{rect:[73,55,77,58]},true);
      run('PLANT',{rect:[73,55,77,58],cropId:'veg_greens'},true);
    } else {
      run('BUILD_ROAD',{tier:1,cells:Array.from({length:10},(_,i)=>[49+i,70])},true);
      run('PLACE_BUILDING',{defId:'house_small',anchor:[50,68],rotation:0},true);
      run('PLACE_BUILDING',{defId:'shop_grocery',anchor:[54,68],rotation:0},true);
      now+=60_000;run('BUY_MATERIAL',{wood:1},true);
    }
    const all:Command['type'][]=['CLEAR_ENV','TERRAFORM','TILL','UNTILL','EMBANK','REMOVE_EMBANK','BUILD_ROAD','REMOVE_ROAD','BUILD_BRIDGE','REMOVE_BRIDGE','PLACE_BUILDING','DEMOLISH','CANCEL_CONSTRUCTION','SPEED_UP','COLLECT','PLANT','HARVEST','START_PRODUCTION','COLLECT_PRODUCTION','SELL','BUY_MATERIAL','UNLOCK_ZONE','CLAIM_QUEST','UPGRADE_BUILDING','CLAIM_RELIEF'];
    for(let n=0;n<500;n++) {
      now+=60_000;
      const type=pick(all);types.add(type);
      const cell:Cell=[72+Math.floor(rng()*7),54+Math.floor(rng()*7)];
      const b=pick(s.snapshot.buildings),bridge=pick(s.snapshot.bridges),env=pick(s.env);
      let payload:unknown;
      switch(type) {
        case 'CLEAR_ENV':payload={envIds:[env?.id ?? 'A-999']};break;
        case 'TERRAFORM':payload={rect:[...cell,...cell],mode:pick(['RAISE','LOWER','FLATTEN']),targetHDm:undefined};
          if((payload as {mode:string}).mode==='FLATTEN') payload={rect:[...cell,...cell],mode:'FLATTEN',targetHDm:50};break;
        case 'TILL':case 'UNTILL':payload={rect:[...cell,...cell]};break;
        case 'EMBANK':case 'REMOVE_EMBANK':payload={cells:[[pick([59,64]),70+Math.floor(rng()*7)]]};break;
        case 'BUILD_ROAD':payload={tier:pick([1,2,3]),cells:[cell]};break;
        case 'REMOVE_ROAD':payload={cells:[cell]};break;
        case 'BUILD_BRIDGE':payload={typeId:pick(Object.keys(catalog.bridges)),a:[59,74],b:[64,74]};break;
        case 'REMOVE_BRIDGE':payload={bridgeId:bridge?.id ?? 'br_missing'};break;
        case 'PLACE_BUILDING':payload={defId:pick(Object.values(catalog.buildings).filter(d=>d.mapKinds.includes(kind))).id,anchor:cell,rotation:pick([0,1,2,3]),autoFlattenHDm:50};break;
        case 'DEMOLISH':case 'CANCEL_CONSTRUCTION':case 'SPEED_UP':payload={buildingId:b?.id ?? 'b_missing'};break;
        case 'COLLECT':payload={buildingIds:b ? [b.id] : []};break;
        case 'PLANT':payload={rect:[...cell,...cell],cropId:pick(Object.keys(catalog.crops))};break;
        case 'HARVEST':payload={cells:[cell]};break;
        case 'START_PRODUCTION':payload={buildingId:b?.id ?? 'b_missing',recipeId:pick(Object.keys(catalog.recipes)),count:pick([1,2,3,4])};break;
        case 'COLLECT_PRODUCTION':payload={buildingId:b?.id ?? 'b_missing'};break;
        case 'SELL':payload={items:{[pick(Object.keys(catalog.items))]:pick([1,2,5])}};break;
        case 'BUY_MATERIAL':payload={wood:pick([1,2,10]),stone:1};break;
        case 'UNLOCK_ZONE':payload={zoneId:Math.floor(rng()*64)};break;
        case 'CLAIM_QUEST':payload={questId:`${kind}-12`};break;
        case 'UPGRADE_BUILDING':payload={buildingId:b?.id ?? 'b_missing'};break;
        case 'CLAIM_RELIEF':payload={};break;
      }
      run(type,payload);
    }
    expect(s.surface.some(v=>v===Surface.WATER)).toBe(true);
  }
  expect(accepted+rejected).toBe(1000);expect(accepted).toBeGreaterThan(150);expect(rejected).toBeGreaterThan(150);expect(types.size).toBe(25);
  console.info(`1000 random commands: ${accepted} accepted, ${rejected} rejected; ${types.size} command types; invariants checked after every command.`);
},60_000);
