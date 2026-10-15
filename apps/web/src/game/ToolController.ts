import { create } from 'zustand';
import { cellIndex, type Cell, type CommandType, type Rotation } from '@xay-nha/contracts';
import { catalog } from '@xay-nha/content';
import { access, buildingAtCell, execute, footprintCells, inBounds, isUnlocked, meanHeight, validate } from '@xay-nha/sim';
import { Surface } from '@xay-nha/contracts';
import { WorldStore, type ToolPreview } from './WorldStore';
import { t } from '../i18n';

/** A non-building map object picked in explore mode (D033): its panel offers the tools that act on it. */
export type Focus={kind:'env';id:string;cell:Cell}|{kind:'road'|'crop'|'tilled';cell:Cell};
export type Tool='explore'|'clear'|'terraform'|'till'|'road'|'embank'|'bridge'|'build'|'plant'|'harvest'|'demolish'|'zone';
interface ToolState {tool:Tool;mode:'RAISE'|'LOWER'|'FLATTEN';remove:boolean;tier:1|2|3;bridgeId:string;buildingId:string;cropId:string;rotation:Rotation;selection:string|null;focus:Focus|null;preview:ToolPreview|null;cell:Cell|null;autoFlatten:boolean;touch:boolean}
export const useTools=create<ToolState>(()=>({tool:'explore',mode:'FLATTEN',remove:false,tier:1,bridgeId:'bridge_wood',buildingId:'farmhouse',cropId:'veg_greens',rotation:0,selection:null,focus:null,preview:null,cell:null,autoFlatten:false,touch:typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches}));

/**
 * Auto-flatten target for a footprint: flush with an adjacent road when there is one (so flattening
 * never tilts the road: AFFECTS_NEIGHBOR), otherwise the footprint's mean height, in 0.5 m steps.
 */
export function flattenTarget(s:WorldStore['state'],cells:Cell[]):number{
  const inside=new Set(cells.map(c=>cellIndex(...c))),road:number[]=[];
  for(const [x,z] of cells)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const){const n:Cell=[x+dx,z+dz];if(inBounds(n)&&!inside.has(cellIndex(...n))&&s.roadTier[cellIndex(...n)])road.push(meanHeight(s,n));}
  const source=road.length?road:cells.map(c=>meanHeight(s,c));
  return Math.round(source.reduce((a,b)=>a+b,0)/source.length/5)*5;
}
/** What a click at `cell` picks besides buildings and bridge ends: scenery, a crop, a road or tilled soil. */
export function focusAt(s:WorldStore['state'],cell:Cell):Focus|null{
  if(!inBounds(cell))return null;
  const i=cellIndex(...cell),id=s.occupancy.get(i),removed=s.snapshot.delta.removedEnvIds;
  const env=id?s.env.find(e=>e.id===id&&!removed.includes(e.id)):undefined;
  if(env)return {kind:'env',id:env.id,cell:env.cell};
  if(s.snapshot.crops.some(c=>cellIndex(...c.cell)===i))return {kind:'crop',cell};
  if(s.roadTier[i])return {kind:'road',cell};
  if(s.surface[i]===Surface.TILLED)return {kind:'tilled',cell};
  return null;
}
export class ToolController {
  private start:Cell|null=null;
  private bridgeStart:Cell|null=null;
  private path:Cell[]=[];
  constructor(readonly world:WorldStore){}
  choose(tool:Tool):void {this.cancel();useTools.setState({tool,remove:false,selection:null,focus:null});}
  rotate(direction=1):void {const rotation=((useTools.getState().rotation+direction+4)%4) as Rotation;useTools.setState({rotation});this.refresh();}
  cancel():void {this.start=null;this.bridgeStart=null;this.path=[];useTools.setState({preview:null});}
  /** Escape: first abandons a drag/bridge in progress, otherwise leaves the tool for explore mode. */
  escape():void {if(this.start||this.bridgeStart){this.cancel();return;}this.choose('explore');}
  down(cell:Cell):void {
    if(!inBounds(cell))return;
    // Explore picks on release (up), so a camera drag that starts on a tree or road does not open its panel.
    if(useTools.getState().tool==='explore') {useTools.setState({cell});return;}
    this.start=cell;this.path=[cell];this.move(cell,true);
  }
  move(cell:Cell,drag=false):void {
    if(!inBounds(cell))return; useTools.setState({cell});
    if(drag&&this.start&&useTools.getState().tool==='road') {
      const last=this.path[this.path.length-1]!;
      let [x,z]=last;
      while(x!==cell[0]&&this.path.length<256){x+=Math.sign(cell[0]-x);this.path.push([x,z]);}
      while(z!==cell[1]&&this.path.length<256){z+=Math.sign(cell[1]-z);this.path.push([x,z]);}
      // Dragging backwards trims the path rather than emitting duplicate cells.
      const seen=new Map<number,number>();let index=0;
      while(index<this.path.length){const key=cellIndex(...this.path[index]!);const prior=seen.get(key);if(prior!==undefined){this.path.splice(prior+1,index-prior);index=prior+1;seen.clear();for(let j=0;j<index;j++)seen.set(cellIndex(...this.path[j]!),j);}else {seen.set(key,index);index++;}}
    }
    this.preview(cell);
  }
  /** Explore click: a building or bridge end opens its panel; otherwise the scenery/crop/road/soil under the cursor. */
  select(cell:Cell):void {
    const s=this.world.state,id=buildingAtCell(s,...cell)??s.snapshot.bridges.find(b=>b.a.toString()===cell.toString()||b.b.toString()===cell.toString())?.id;
    useTools.setState({selection:id??null,focus:id?null:focusAt(s,cell),cell});
  }
  up(cell:Cell,touch:boolean,dragged=false):void {
    if(useTools.getState().tool==='explore'){if(!dragged)this.select(cell);return;}
    if(useTools.getState().tool==='bridge'&&!this.bridgeStart){this.bridgeStart=cell;this.start=null;this.world.message(t('selectEnd'));return;}
    // Mouse confirms on release, except demolition (destructive: waits for the red button). Touch only previews; the primary button commits.
    this.preview(cell);if(!touch&&useTools.getState().tool!=='demolish')this.confirm();this.start=null;this.path=[];
  }
  refresh():void {const cell=useTools.getState().cell;if(cell)this.preview(cell);}
  confirm():void {
    const preview=useTools.getState().preview;
    if(!preview?.command)return;
    const result=this.world.apply(preview.command.type,preview.command.payload);
    // A placed building ends build mode, so a later click (e.g. on its coin) cannot buy a second one by accident.
    if(result.result.accepted){if(preview.command.type==='PLACE_BUILDING')this.choose('explore');else this.cancel();}else this.refresh();
  }
  private preview(cell:Cell):void {
    const ui=useTools.getState(),s=this.world.state,start=this.start??cell;
    const rect:[number,number,number,number]=[Math.min(start[0],cell[0]),Math.min(start[1],cell[1]),Math.max(start[0],cell[0]),Math.max(start[1],cell[1])];
    let cells:Cell[]=[];for(let z=rect[1];z<=rect[3]&&cells.length<=256;z++)for(let x=rect[0];x<=rect[2]&&cells.length<=256;x++)cells.push([x,z]);
    let type:CommandType|undefined,payload:unknown,warning=false;
    switch(ui.tool){
      case 'clear': {type='CLEAR_ENV';const ids=new Set(cells.map(c=>s.occupancy.get(cellIndex(...c))).filter((id):id is string=>!!id&&s.env.some(e=>e.id===id)));payload={envIds:[...ids]};break;}
      case 'terraform':type='TERRAFORM';payload={rect,mode:ui.mode};break;
      case 'till':type=ui.remove?'UNTILL':'TILL';payload={rect};break;
      case 'road':type=ui.remove?'REMOVE_ROAD':'BUILD_ROAD';cells=this.path.length?this.path:[cell];payload=ui.remove?{cells}:{cells,tier:ui.tier};break;
      case 'embank':type=ui.remove?'REMOVE_EMBANK':'EMBANK';payload={cells};break;
      case 'bridge': {if(ui.remove){type='REMOVE_BRIDGE';payload={bridgeId:s.occupancy.get(cellIndex(...cell))};}else if(this.bridgeStart){type='BUILD_BRIDGE';payload={typeId:ui.bridgeId,a:this.bridgeStart,b:cell};}break;}
      case 'build': {const def=catalog.buildings[ui.buildingId]!;cells=footprintCells(def,cell,ui.rotation);type='PLACE_BUILDING';payload={defId:def.id,anchor:cell,rotation:ui.rotation,...(ui.autoFlatten?{autoFlattenHDm:flattenTarget(s,cells)}:{})};warning=ui.autoFlatten;break;}
      case 'plant':type='PLANT';payload={rect,cropId:ui.cropId};break;
      case 'harvest':type='HARVEST';payload={cells};break;
      case 'demolish': {const id=buildingAtCell(s,...cell);type=id?'DEMOLISH':'REMOVE_BRIDGE';payload=id?{buildingId:id}:{bridgeId:s.occupancy.get(cellIndex(...cell))};break;}
      case 'zone':type='UNLOCK_ZONE';payload={zoneId:Math.floor(cell[1]/16)*8+Math.floor(cell[0]/16)};break;
    }
    if(!type){useTools.setState({preview:{command:null,cells,valid:false,warning:false}});return;}
    const command=this.world.command(type,payload),result=validate(s,command,this.world.now());
    let note:string|undefined,bad:Cell[]|undefined,refund:number|undefined;
    if(result.valid&&(type==='REMOVE_ROAD'||type==='REMOVE_BRIDGE'||type==='DEMOLISH')){
      // Consequence preview: which working buildings would be cut off from the road network.
      const next=execute(s,command,this.world.now()).state;
      const cut=s.snapshot.buildings.filter(b=>b.status==='ACTIVE'&&access(s,b)>0&&next.snapshot.buildings.some(n=>n.id===b.id)&&!access(next,next.snapshot.buildings.find(n=>n.id===b.id)!)).length;
      if(type!=='REMOVE_ROAD')refund=next.snapshot.wallet.cash-s.snapshot.wallet.cash;
      if(cut){note=`${cut} công trình sẽ mất đường nối và ngừng hoạt động.`;warning=true;}
    }
    if(!result.valid)bad=cells.filter(c=>{const i=cellIndex(...c),id=s.occupancy.get(i);
      return !isUnlocked(s,c)||(type!=='CLEAR_ENV'&&type!=='DEMOLISH'&&type!=='HARVEST'&&!!id&&!(type==='REMOVE_ROAD'))||(type!=='BUILD_BRIDGE'&&type!=='EMBANK'&&s.surface[i]===Surface.WATER);});
    useTools.setState({preview:{command,cells,valid:result.valid,warning:result.valid&&warning,...(result.valid?{cost:result.cost}:{code:result.code}),...(note?{note}:{}),...(refund!==undefined?{refund}:{}),...(bad?.length?{bad}:{})}});
    // The invalid reason stays inline (preview bar + red cells); only a rejected confirm toasts (WorldStore.dispatch).
  }
}
