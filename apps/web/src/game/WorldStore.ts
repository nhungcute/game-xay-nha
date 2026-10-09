import { create } from 'zustand';
import type { Command, CommandType, Cost, ErrorCode, WorldTemplate } from '@xay-nha/contracts';
import { advanceTime, cloneState, createState, execute, recompute, validateSnapshot, type SimState } from '@xay-nha/sim';
import { generateEnvironment, validateTemplate } from '@xay-nha/worldgen';
import { errorText, t } from '../i18n';

export interface WorldView { state: SimState | null; message: string; error: boolean; cacheStatus: string }
export const useWorld = create<WorldView>(() => ({state:null,message:'',error:false,cacheStatus:''}));
type Listener = (state: SimState, dirty: readonly number[], entitiesChanged: boolean) => void;

export class SnapshotCache {
  private db: IDBDatabase | undefined;
  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve,reject) => {
      const request=indexedDB.open('xay-nha-offline-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('worlds');
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
  }
  async read(key:string):Promise<unknown> {
    return new Promise((resolve,reject)=>{ const request=this.db!.transaction('worlds').objectStore('worlds').get(key); request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error); });
  }
  async write(state:SimState):Promise<void> {
    const snapshot=structuredClone(state.snapshot);
    await new Promise<void>((resolve,reject)=>{const tx=this.db!.transaction('worlds','readwrite');tx.objectStore('worlds').put(snapshot,snapshot.worldId);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }
  close():void {this.db?.close();}
}

/** G1 local adapter. G2 replaces transport; all previews and writes already use sim. */
export class WorldStore {
  state: SimState;
  private readonly listeners=new Set<Listener>();
  private readonly cache=new SnapshotCache();
  private readonly results=new Map<string,ReturnType<typeof execute>>();
  private saveChain=Promise.resolve();
  private timeOffset=0;
  private disposed=false;
  constructor(template:WorldTemplate,now=Date.now()) {
    const errors=validateTemplate(template); if(errors.length)throw new Error(errors.join('\n'));
    this.state=createState(template,now,generateEnvironment(template),{worldId:'offline-farm',accountId:'offline',displayName:'Người chơi',tag:'0001'});
    recompute(this.state); useWorld.setState({state:this.state});
  }
  now():number {return Math.max(this.state.snapshot.serverTime,Date.now()+this.timeOffset);}
  async load():Promise<void> {
    try {
      await this.cache.open(); const cached=await this.cache.read(this.state.snapshot.worldId);
      if(cached!==undefined) {
        const checked=validateSnapshot(this.state,cached,this.now());
        if(checked.ok) {this.state=checked.state;this.publish(Array.from({length:64},(_,i)=>i),true);}
        else this.message(t('cacheError'),true);
      }
    } catch(error) {this.message(`${t('cacheError')} ${error instanceof Error?error.message:''}`,true);}
  }
  command(type:CommandType,payload:unknown):Command {
    return {type,payload,commandId:crypto.randomUUID(),worldId:this.state.snapshot.worldId,expectedRevision:this.state.snapshot.revision,clientTime:this.now()} as Command;
  }
  apply(type:CommandType,payload:unknown):ReturnType<typeof execute> {return this.dispatch(this.command(type,payload));}
  dispatch(command:Command):ReturnType<typeof execute> {
    const prior=this.results.get(command.commandId);if(prior)return prior;
    const execution=execute(this.state,command,this.now());this.results.set(command.commandId,execution);
    if(execution.result.accepted) {this.state=execution.state;this.publish(execution.dirtyZones,true);this.save();this.message(t('valid'));}
    else this.message(errorText(execution.result.code),true);
    return execution;
  }
  tick():void {
    const next=cloneState(this.state),before=JSON.stringify([next.snapshot.buildings,next.snapshot.bridges]);
    advanceTime(next,this.now());this.state=next;
    this.publish([],before!==JSON.stringify([next.snapshot.buildings,next.snapshot.bridges]));
  }
  /** Only exposed in development test harness; progression still runs through sim. */
  advanceForTest(ms:number):void {this.timeOffset+=ms;this.tick();}
  subscribe(listener:Listener):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  message(message:string,error=false):void {useWorld.setState({message,error});}
  private publish(dirty:readonly number[],entitiesChanged:boolean):void {useWorld.setState({state:this.state});for(const listener of this.listeners)listener(this.state,dirty,entitiesChanged);}
  save():void {
    this.saveChain=this.saveChain.then(async()=>{if(!this.disposed){await this.cache.write(this.state);useWorld.setState({cacheStatus:t('saved')});}}).catch(()=>this.message(t('cacheError'),true));
  }
  async flush():Promise<void> {await this.saveChain;}
  dispose():void {this.disposed=true;this.cache.close();this.listeners.clear();}
}
export interface ToolPreview { command:Command|null; cells:import('@xay-nha/contracts').Cell[]; valid:boolean; warning:boolean; code?:ErrorCode; cost?:Cost }
