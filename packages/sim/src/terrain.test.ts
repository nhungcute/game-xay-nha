import { describe, expect, it } from 'vitest';
import { CellFlag, Surface, cellIndex, decodeInt16, vertIndex, type Command, type ErrorCode } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { execute } from './engine';
import { cloneState, corners, createState, type SimState } from './state';
import { roadModule } from './roads';

const NOW=1_000_000;
function state():SimState {
  const s=createState(createTestTemplate(),NOW);
  s.snapshot.wallet={cash:100000,wood:1000,stone:1000};
  s.snapshot.progress.level=20;s.snapshot.progress.xp=economy.xp.cumulative.farm[20]!;
  s.snapshot.progress.questIndex=12;s.snapshot.progress.tutorialDone=true;
  return s;
}
function cmd(s:SimState,type:Command['type'],payload:unknown):unknown {
  return {commandId:'00000000-0000-4000-8000-000000000001',worldId:s.snapshot.worldId,expectedRevision:s.snapshot.revision,clientTime:NOW,type,payload};
}
function accepted(s:SimState,type:Command['type'],payload:unknown) {
  const result=execute(s,cmd(s,type,payload),NOW);
  expect(result.result.accepted).toBe(true);return result;
}
function rejected(s:SimState,type:Command['type'],payload:unknown,code:ErrorCode):void {
  const before=cloneState(s),r=execute(s,cmd(s,type,payload),NOW);
  expect(r.result).toMatchObject({accepted:false,code});expect(r.state).toBe(s);
  expect(s.snapshot).toEqual(before.snapshot);expect(s.heights).toEqual(before.heights);expect(s.surface).toEqual(before.surface);
}

describe('terrain commands through atomic engine',()=>{
  it('raises exactly four corners by 5dm for $12',()=>{
    const s=state(),c:[number,number]=[74,54],r=accepted(s,'TERRAFORM',{rect:[...c,...c],mode:'RAISE'});
    expect(r.cost.cash).toBe(12);
    for (let i=0;i<s.heights.length;i++) expect(r.state.heights[i]).toBe(s.heights[i]!+(corners(c).includes(i)?5:0));
    expect(s.snapshot.wallet.cash-r.state.snapshot.wallet.cash).toBe(12);
  });
  it('lowers all selected vertices and reverts a chunk with an effective base patch',()=>{
    const first=accepted(state(),'TERRAFORM',{rect:[74,54,74,54],mode:'RAISE'});
    const second=accepted(first.state,'TERRAFORM',{rect:[74,54,74,54],mode:'LOWER'});
    expect(second.state.heights).toEqual(state().heights);
    expect(second.state.snapshot.delta.zones).toEqual({});
    expect(second.dirtyZones).toEqual([28]);
    expect(second.result.accepted && second.result.patch.zones?.[28]).toBeDefined();
  });
  it('flatten default averages unique vertices and rounds to player step',()=>{
    const s=state();corners([74,54]).forEach((i,k)=>{s.heights[i]=[45,50,50,55][k]!;});
    const r=accepted(s,'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN'});
    expect(corners([74,54]).map(i=>r.state.heights[i])).toEqual([50,50,50,50]);expect(r.cost.cash).toBe(6);
  });
  it('rounds a fractional natural-height cost up to integer money',()=>{
    const s=state();corners([74,54]).forEach(i=>{s.heights[i]=46;});
    const r=accepted(s,'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN',targetHDm:50});
    expect(r.cost.cash).toBe(10);expect(Number.isInteger(r.state.snapshot.wallet.cash)).toBe(true);
  });
  it('does not charge for flattening an already flat cell',()=>expect(accepted(state(),'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN',targetHDm:50}).cost.cash).toBe(0));
  it.each(['RAISE','LOWER','FLATTEN'])('rejects %s on water',mode=>rejected(state(),'TERRAFORM',{rect:[61,54,61,54],mode,...(mode==='FLATTEN'?{targetHDm:35}:{})},'CELL_BLOCKED'));
  it('rejects terrain on the village road',()=>rejected(state(),'TERRAFORM',{rect:[70,79,70,79],mode:'RAISE'},'CELL_BLOCKED'));
  it('requires clearing a blocking tree first',()=>rejected(state(),'TERRAFORM',{rect:[50,50,50,50],mode:'RAISE'},'OCCUPIED'));
  it('rejects a height shared with a protected neighboring cell',()=>{
    const s=state();s.flags[cellIndex(75,54)]=CellFlag.PROTECTED;
    rejected(s,'TERRAFORM',{rect:[74,54,74,54],mode:'RAISE'},'PROTECTED');
  });
  it('rejects a changed shared corner in a locked neighboring zone',()=>rejected(state(),'TERRAFORM',{rect:[79,54,79,54],mode:'RAISE'},'ZONE_LOCKED'));
  it('rejects a boundary jump over 20dm',()=>rejected(state(),'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN',targetHDm:75},'TOO_STEEP_EDGE'));
  it('rejects a height over the map ceiling',()=>rejected(state(),'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN',targetHDm:335},'TOO_STEEP'));
  it('rejects flatten target off the 5dm grid',()=>rejected(state(),'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN',targetHDm:51},'INVALID_COMMAND'));
  it('rejects a 17x16 rectangle with AREA_TOO_LARGE before allocation',()=>rejected(state(),'TERRAFORM',{rect:[64,48,80,63],mode:'RAISE'},'AREA_TOO_LARGE'));
  it('rejects deformation that makes an adjacent road too steep',()=>{
    const s=accepted(state(),'BUILD_ROAD',{tier:1,cells:[[75,54]]}).state;
    rejected(s,'TERRAFORM',{rect:[74,54,74,54],mode:'FLATTEN',targetHDm:65},'AFFECTS_NEIGHBOR');
  });
  it('allows a shared neighboring road when its slope remains legal',()=>{
    const s=accepted(state(),'BUILD_ROAD',{tier:1,cells:[[75,54]]}).state;
    accepted(s,'TERRAFORM',{rect:[74,54,74,54],mode:'RAISE'});
  });
  it('refuses deformation of a bridge abutment even when the neighboring road stays within slope limits',()=>{
    const s=state();s.snapshot.bridges.push({id:'br_test',typeId:'bridge_wood',a:[75,54],b:[79,54],deckHeightDm:50,
      placedAt:NOW,buildEndsAt:NOW+180000,status:'CONSTRUCTING',cashPaid:240,materialsPaid:{cash:240,wood:15,stone:0},investedValue:465});
    rejected(s,'TERRAFORM',{rect:[74,54,74,54],mode:'RAISE'},'AFFECTS_NEIGHBOR');
  });
  it('rejects lowering an unembanked shoreline below water+5',()=>rejected(state(),'TERRAFORM',{rect:[64,54,64,54],mode:'FLATTEN',targetHDm:30},'SHORE_RULE'));
  it('keeps the minimum water+5 even after embanking per docs15',()=>{
    const s=accepted(state(),'EMBANK',{cells:[[64,54]]}).state;
    rejected(s,'TERRAFORM',{rect:[64,54,64,54],mode:'FLATTEN',targetHDm:30},'SHORE_RULE');
  });
  it('allows a vertical raised bank after embanking',()=>{
    const s=state();for(let z=53;z<=55;z++) s.flags[cellIndex(64,z)]=CellFlag.EMBANKED;
    accepted(s,'TERRAFORM',{rect:[64,54,64,54],mode:'FLATTEN',targetHDm:55});
  });
  it('writes identical shared edges into both adjoining chunks',()=>{
    const r=accepted(state(),'TERRAFORM',{rect:[74,63,74,63],mode:'RAISE'});
    expect(r.dirtyZones).toEqual([28,36]);
    const top=decodeInt16(r.state.snapshot.delta.zones[28]!.heightsDm,289),bottom=decodeInt16(r.state.snapshot.delta.zones[36]!.heightsDm,289);
    expect([...top.slice(16*17)]).toEqual([...bottom.slice(0,17)]);
  });
  it('marks all four zones sharing a changed corner',()=>{
    const r=accepted(state(),'TERRAFORM',{rect:[64,64,64,64],mode:'RAISE'});
    expect(r.dirtyZones).toEqual([27,28,35,36]);
    expect(r.state.heights[vertIndex(64,64)]).toBe(40);
  });
  it('insufficient funds leaves terrain and dirty deltas unchanged',()=>{
    const s=state();s.snapshot.wallet.cash=0;
    rejected(s,'TERRAFORM',{rect:[74,54,74,54],mode:'RAISE'},'INSUFFICIENT_FUNDS');
  });
});

describe('roads and embankment',()=>{
  it('builds tier1, upgrades with differences, and ignores an equal or lower tier',()=>{
    let r=accepted(state(),'BUILD_ROAD',{tier:1,cells:[[74,54]]});expect(r.cost).toEqual({cash:5,wood:0,stone:0});
    r=accepted(r.state,'BUILD_ROAD',{tier:2,cells:[[74,54]]});expect(r.cost).toEqual({cash:10,wood:0,stone:1});
    r=accepted(r.state,'BUILD_ROAD',{tier:3,cells:[[74,54]]});expect(r.cost).toEqual({cash:25,wood:0,stone:1});
    expect(accepted(r.state,'BUILD_ROAD',{tier:1,cells:[[74,54]]}).cost).toEqual({cash:0,wood:0,stone:0});
  });
  it('rejects road through water',()=>rejected(state(),'BUILD_ROAD',{tier:1,cells:[[61,54]]},'CELL_BLOCKED'));
  it('rejects road through tilled ground',()=>{
    const s=state();s.surface[cellIndex(74,54)]=Surface.TILLED;rejected(s,'BUILD_ROAD',{tier:1,cells:[[74,54]]},'CELL_TILLED');
  });
  it('rejects road across a tree',()=>rejected(state(),'BUILD_ROAD',{tier:1,cells:[[50,50]]},'OCCUPIED'));
  it('rejects road on a cell steeper than 10dm',()=>{
    const s=state();s.heights[vertIndex(74,54)]=65;rejected(s,'BUILD_ROAD',{tier:1,cells:[[74,54]]},'TOO_STEEP');
  });
  it('rejects disconnected road-list geometry at schema boundary',()=>rejected(state(),'BUILD_ROAD',{tier:1,cells:[[74,54],[76,54]]},'INVALID_COMMAND'));
  it('marks road cells connected upon build and disconnects them upon removal (D039 Law A)',()=>{
    let s=accepted(state(),'BUILD_ROAD',{tier:1,cells:[[70,76]]}).state;expect(s.connected[cellIndex(70,76)]).toBe(1);
    s=accepted(s,'REMOVE_ROAD',{cells:[[70,76]]}).state;expect(s.connected[cellIndex(70,76)]).toBe(0);expect(s.surface[cellIndex(70,76)]).toBe(Surface.DIRT);
  });
  it('allows ENTRY upgrades while refusing ENTRY removal',()=>{
    const s=accepted(state(),'BUILD_ROAD',{tier:2,cells:[[70,79]]}).state;
    rejected(s,'REMOVE_ROAD',{cells:[[70,79]]},'PROTECTED');
  });
  it('requires the road tier unlock level',()=>{
    const s=state();s.snapshot.progress.level=1;s.snapshot.progress.xp=0;
    rejected(s,'BUILD_ROAD',{tier:2,cells:[[74,54]]},'LEVEL_REQUIRED');
  });
  it('embanks once and refunds floor50% of each component on removal',()=>{
    const s=state(),r=accepted(s,'EMBANK',{cells:[[64,54]]});expect(r.cost).toEqual(economy.embank.cost);
    expect(accepted(r.state,'EMBANK',{cells:[[64,54]]}).cost.cash).toBe(0);
    const next=accepted(r.state,'REMOVE_EMBANK',{cells:[[64,54]]}).state;
    expect(next.flags[cellIndex(64,54)]!&CellFlag.EMBANKED).toBe(0);
    expect(next.snapshot.wallet.cash-r.state.snapshot.wallet.cash).toBe(15);expect(next.snapshot.wallet.stone-r.state.snapshot.wallet.stone).toBe(1);
  });
  it('rejects embankment on dry inland cells',()=>rejected(state(),'EMBANK',{cells:[[74,54]]},'NOT_SHORE'));
  it('rejects removing embankment from a raised vertical bank',()=>{
    const s=state();for(let z=53;z<=55;z++) s.flags[cellIndex(64,z)]=CellFlag.EMBANKED;
    const raised=accepted(s,'TERRAFORM',{rect:[64,54,64,54],mode:'FLATTEN',targetHDm:55}).state;
    rejected(raised,'REMOVE_EMBANK',{cells:[[64,54]]},'SHORE_RULE');
  });
  it.each(Array.from({length:16},(_,i)=>i))('autotiles neighbor mask %i',mask=>{
    const expected=['ISOLATED','END','END','CORNER','END','STRAIGHT','CORNER','T','END','CORNER','STRAIGHT','T','CORNER','T','T','CROSS'];
    expect(roadModule(mask)).toBe(expected[mask]);
  });
});
