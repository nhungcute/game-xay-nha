import { useEffect, useRef, useState } from 'react';
import { catalog } from '@xay-nha/content';
import type { CommandType } from '@xay-nha/contracts';
import { access, builderCapacity, buildingLimit, fieldQuota, inventoryCount, populationAndJobs, storageCapacity } from '@xay-nha/sim';
import { AssetManager } from './game/assets/AssetManager';
import { GameLoop } from './game/GameLoop';
import { WorldStore, useWorld } from './game/WorldStore';
import { useTools, type Tool } from './game/ToolController';
import { duration, errorText, money, t } from './i18n';

const toolIcons:Record<Tool,string>={explore:'◉',clear:'♠',terraform:'▱',till:'⚒',road:'━',embank:'▥',bridge:'⌒',build:'⌂',plant:'♧',harvest:'✂',demolish:'×',zone:'▦'};
const FARM_ONLY:Tool[]=['till','plant','harvest'];
export interface GameProps { loader:()=>Promise<WorldStore>; onSwitchMap?:(world:WorldStore)=>void }
export function Game({loader,onSwitchMap}:GameProps){
  const canvas=useRef<HTMLCanvasElement>(null),gameRef=useRef<GameLoop|null>(null);
  const [ready,setReady]=useState(false),[loadingError,setLoadingError]=useState(''),[attempt,setAttempt]=useState(0),[panel,setPanel]=useState<'inventory'|'materials'|null>(null),[stats,setStats]=useState<ReturnType<GameLoop['metrics']>|null>(null);
  const {state,message,error,cacheStatus,connection,pending}=useWorld(),ui=useTools();
  useEffect(()=>{
    let cancelled=false;let game:GameLoop|undefined;let world:WorldStore|undefined;const assets=new AssetManager();
    const start=async()=>{
      world=await loader();await world.load();await assets.load();
      if(cancelled){assets.dispose();world.dispose();return;}
      game=new GameLoop(canvas.current!,world,assets);gameRef.current=game;setReady(true);
    };
    void start().catch(cause=>{assets.dispose();world?.dispose();if(!cancelled)setLoadingError(`${t('loadError')} ${cause instanceof Error?cause.message:String(cause)}`);});
    return()=>{cancelled=true;game?.dispose();gameRef.current=null;};
  },[attempt]);
  useEffect(()=>{if(!ready)return;const id=window.setInterval(()=>setStats(gameRef.current?.metrics()??null),1000);return()=>window.clearInterval(id);},[ready]);
  const apply=(type:CommandType,payload:unknown)=>gameRef.current?.world.apply(type,payload);
  const choose=(tool:Tool)=>gameRef.current?.tools.choose(tool);
  const update=(patch:Partial<typeof ui>)=>{useTools.setState(patch);gameRef.current?.tools.refresh();};
  const selected=state?.snapshot.buildings.find(b=>b.id===ui.selection),bridge=state?.snapshot.bridges.find(b=>b.id===ui.selection),object=selected??bridge;
  const busy=state?[...state.snapshot.buildings,...state.snapshot.bridges].filter(b=>b.status==='CONSTRUCTING').length:0;
  const kind=state?.template.mapKind??'farm',kindLabel=kind==='city'?'THÀNH PHỐ':'QUÊ';
  const q=state?catalog.quests[kind][state.snapshot.progress.questIndex]:undefined;
  const toolList=(Object.keys(toolIcons) as Tool[]).filter(tool=>kind==='farm'||!FARM_ONLY.includes(tool));
  const people=state&&kind==='city'?populationAndJobs(state):null;
  const status=connection==='local'?t('offline'):connection==='online'?t('connected'):connection==='syncing'?`${t('syncing')} (${pending})`:`${t('disconnected')} (${pending})`;
  const preview=ui.preview;
  return <main>
    <canvas ref={canvas} aria-label="Bản đồ 3D"/>
    {!ready&&<div className="loading"><h1>Xây Nhà</h1><p>{loadingError||t('loading')}</p>{loadingError&&<button onClick={()=>{setLoadingError('');setAttempt(attempt+1);}}>{t('retry')}</button>}</div>}
    {ready&&state&&<>
      <header className="hud"><div className="brand"><span className="brand-icon">⌂</span><div><strong>XÂY NHÀ <small>{kindLabel}</small></strong><span>{state.snapshot.character.displayName}#{state.snapshot.character.tag} · {t('level')} {state.snapshot.progress.level} · {state.snapshot.progress.xp} XP</span></div></div><div className="resources"><strong className="cash">{money(state.snapshot.wallet.cash)}</strong><button onClick={()=>setPanel(panel==='materials'?null:'materials')}>🪵 {state.snapshot.wallet.wood} &nbsp; ◇ {state.snapshot.wallet.stone}</button><span>{t('builders')} {busy}/{builderCapacity(state)}</span>{kind==='farm'?<button onClick={()=>setPanel(panel==='inventory'?null:'inventory')}>{t('storage')} {inventoryCount(state)}/{storageCapacity(state)}</button>:<span>{t('people')} {people?.population??0}/{people?.jobs??0}</span>}{onSwitchMap&&<button aria-label={t('switchMap')} title={t('switchMap')} onClick={()=>{const w=gameRef.current?.world;if(w)onSwitchMap(w);}}>🗺</button>}</div><div className="sub-hud"><span>{t('worth')} {money(state.snapshot.character.netWorth)}</span>{kind==='farm'&&<span>{t('fields')} {state.snapshot.crops.length}/{fieldQuota(state)}</span>}<span className={connection==='offline'?'error':''} role="status">{status}</span></div></header>
      {q&&<aside className="quest panel"><small>{t('quests')} {state.snapshot.progress.questIndex+1}/{catalog.quests[kind].length}</small><strong>{t(q.nameKey)}</strong><span>{state.snapshot.progress.questProgress[q.id]??0}/{q.target} · {money(q.reward.cash)} · {q.xp} XP</span><button onClick={()=>apply('CLAIM_QUEST',{questId:q.id})}>{t('claim')}</button></aside>}
      <div className="camera-buttons"><button aria-label="Phóng to" onClick={()=>gameRef.current?.rig.zoom(-140)}>＋</button><button aria-label="Thu nhỏ" onClick={()=>gameRef.current?.rig.zoom(140)}>−</button><button aria-label={t('resetCamera')} onClick={()=>gameRef.current?.rig.reset()}>⟲</button></div>
      {panel&&<aside className="side panel"><button className="close" onClick={()=>setPanel(null)}>×</button><h2>{t(panel)}</h2>{panel==='materials'?(['wood','stone'] as const).map(material=><div className="item" key={material}><span>{t(material)}</span>{[1,10].map(count=><button key={count} onClick={()=>apply('BUY_MATERIAL',{[material]:count})}>{t('buy')} {count}</button>)}</div>):Object.entries(state.snapshot.inventory).map(([id,count])=><div className="item" key={id}><span>{t(catalog.items[id]?.nameKey??id)} × {count}</span><button disabled={!count} onClick={()=>apply('SELL',{items:{[id]:count}})}>{t('sell')} {money(count*(catalog.items[id]?.sellPrice??0))}</button></div>)}</aside>}
      {object&&<aside className="side panel"><button className="close" onClick={()=>update({selection:null})}>×</button><h2>{selected?t(catalog.buildings[selected.defId]!.nameKey):'Cầu'}</h2><p>{object.status==='CONSTRUCTING'?`${t('progress')} ${duration(object.buildEndsAt-state.snapshot.serverTime)}`:t('active')}</p>{object.status==='CONSTRUCTING'?<><button onClick={()=>apply('SPEED_UP',selected?{buildingId:object.id}:{bridgeId:object.id})}>{t('speed')}</button><button onClick={()=>apply('CANCEL_CONSTRUCTION',selected?{buildingId:object.id}:{bridgeId:object.id})}>{t('cancel')} · 100%</button></>:selected?<><p>{access(state,selected)?t('active'):t('noRoad')}</p>{catalog.buildings[selected.defId]?.baseRatePerHour?<><p>{t('income')} {money(state.rates[selected.id]??0)}/h · {t('waiting')} {money(selected.accrued??0)}</p><button disabled={(selected.accrued??0)<1} onClick={()=>apply('COLLECT',{buildingIds:[selected.id]})}>{t('collectMoney')}</button></>:null}{catalog.buildings[selected.defId]?.production?.recipes.map(id=><button key={id} onClick={()=>apply('START_PRODUCTION',{buildingId:selected.id,recipeId:id,count:1})}>{t('produce')} · {t(catalog.items[catalog.recipes[id]!.output]!.nameKey)}</button>)}{selected.slots&&<><button onClick={()=>apply('COLLECT_PRODUCTION',{buildingId:selected.id})}>{t('collect')}</button>{selected.slots.flat().map((job,index)=><p key={index}>{t(catalog.items[catalog.recipes[job.recipeId]!.output]!.nameKey)} · {duration(job.readyAt-state.snapshot.serverTime)}</p>)}</>}<button onClick={()=>apply('DEMOLISH',{buildingId:selected.id})}>{t('demolish')}</button></>:<button onClick={()=>apply('REMOVE_BRIDGE',{bridgeId:object.id})}>{t('remove')}</button>}</aside>}
      {ui.tool==='build'&&<aside className="catalog panel"><h2>{t('build')}</h2>{Object.values(catalog.buildings).filter(d=>d.mapKinds.includes(kind)).map(def=>{const count=state.snapshot.buildings.filter(b=>b.defId===def.id).length,limit=buildingLimit(state,def);return <button className={ui.buildingId===def.id?'selected':''} key={def.id} onClick={()=>update({buildingId:def.id})}><strong>{t(def.nameKey)}</strong><span>{def.size.join(' × ')} · {money(def.cost.cash)} · 🪵{def.cost.wood} ◇{def.cost.stone}</span><span>{t('level')} {def.unlockLevel} · {duration(def.buildSeconds*1000)} · {count}/{Number.isFinite(limit)?limit:'∞'}</span></button>;})}</aside>}
      <footer>
        <div className="feedback"><span className={error?'error':''} role="status">{message||t('select')}</span><small>{cacheStatus}</small></div>
        {ui.tool!=='explore'&&<div className="tool-options panel"><strong>{t(ui.tool)}</strong>
          {ui.tool==='terraform'&&(['RAISE','LOWER','FLATTEN'] as const).map(mode=><button className={ui.mode===mode?'selected':''} key={mode} onClick={()=>update({mode})}>{t(mode.toLowerCase())}</button>)}
          {ui.tool==='road'&&([1,2,3] as const).map(tier=><button className={ui.tier===tier?'selected':''} key={tier} onClick={()=>update({tier})}>{['Đường đất','Lát đá','Nhựa'][tier-1]}</button>)}
          {ui.tool==='bridge'&&<select value={ui.bridgeId} onChange={e=>update({bridgeId:e.target.value})}>{Object.values(catalog.bridges).map(def=><option key={def.id} value={def.id}>{def.id==='bridge_wood'?'Cầu gỗ':def.id==='bridge_stone'?'Cầu đá':'Cầu bê tông'} · {t('level')} {def.unlockLevel}</option>)}</select>}
          {['road','embank','bridge','till'].includes(ui.tool)&&<label><input type="checkbox" checked={ui.remove} onChange={e=>update({remove:e.target.checked})}/>{t('remove')}</label>}
          {ui.tool==='build'&&<><button onClick={()=>gameRef.current?.tools.rotate()}>{t('rotate')} {ui.rotation*90}°</button><label><input type="checkbox" checked={ui.autoFlatten} onChange={e=>update({autoFlatten:e.target.checked})}/>San tự động</label></>}
          {ui.tool==='plant'&&<select value={ui.cropId} onChange={e=>update({cropId:e.target.value})}>{Object.values(catalog.crops).map(crop=><option key={crop.id} value={crop.id}>{t(crop.nameKey)} · {money(crop.seedCost)} · {t('level')} {crop.unlockLevel}</option>)}</select>}
          <span className={`preview-cost ${preview?.valid?(preview.warning?'warning':'valid'):'error'}`}>{preview?.cost?`${money(preview.cost.cash)} · 🪵${preview.cost.wood} ◇${preview.cost.stone}`:preview?.code?errorText(preview.code):t('select')}</span><button className="primary" disabled={!preview?.valid} onClick={()=>gameRef.current?.tools.confirm()}>✓ {t('confirm')}</button><button onClick={()=>gameRef.current?.tools.cancel()}>× {t('cancel')}</button>
        </div>}
        <nav className="tools panel" aria-label="Công cụ">{toolList.map(tool=><button aria-pressed={ui.tool===tool} className={ui.tool===tool?'selected':''} key={tool} onClick={()=>choose(tool)}><b>{toolIcons[tool]}</b><span>{t(tool)}</span></button>)}</nav><p className="controls">{matchMedia('(pointer:coarse)').matches?t('touchControls'):t('controls')}</p>
      </footer>
      {new URLSearchParams(location.search).get('debug')==='1'&&<pre className="debug">{stats?`${stats.fps.toFixed(1)} FPS · ${stats.drawCalls} calls · ${stats.triangles} triangles\nGPU objects ${stats.geometries} geometries / ${stats.textures} textures / ${stats.programs} programs\nZone ${stats.terrain.lastRebuildMs.toFixed(2)} ms · max ${stats.terrain.maxRebuildMs.toFixed(2)} ms · revision ${stats.revision}\nCell ${ui.cell?.join(',')??'—'}`:''}</pre>}
    </>}
  </main>;
}
