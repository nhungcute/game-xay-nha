import { useEffect, useRef, useState } from 'react';
import { catalog, economy } from '@xay-nha/content';
import type { CommandType } from '@xay-nha/contracts';
import { access, authoredQuestProgress, builderCapacity, buildingLimit, fieldQuota, inventoryCount, populationAndJobs, repeatQuestProgress, storageCapacity } from '@xay-nha/sim';
import type { RepeatQuest } from '@xay-nha/contracts';
import { AssetManager } from './game/assets/AssetManager';
import { GameLoop } from './game/GameLoop';
import { WorldStore, useWorld } from './game/WorldStore';
import { useTools, type Tool } from './game/ToolController';
import { duration, errorText, money, t } from './i18n';

const toolIcons:Record<Tool,string>={explore:'◉',clear:'♠',terraform:'▱',till:'⚒',road:'━',embank:'▥',bridge:'⌒',build:'⌂',plant:'♧',harvest:'✂',demolish:'×',zone:'▦'};
const FARM_ONLY:Tool[]=['till','plant','harvest'];
function Profile({ state }: { state: NonNullable<ReturnType<typeof useWorld.getState>['state']> }) {
  const s = state.snapshot, mat = (w: number, st: number) => w * economy.materialPrices.wood + st * economy.materialPrices.stone;
  const buildings = s.buildings.reduce((v, b) => v + b.investedValue, 0), bridges = s.bridges.reduce((v, b) => v + b.investedValue, 0);
  const pending = s.buildings.reduce((v, b) => v + Math.floor(b.accrued ?? 0), 0);
  const goods = Object.entries(s.inventory).reduce((v, [id, n]) => v + n * (catalog.items[id]?.sellPrice ?? 0), 0);
  const cash = s.wallet.cash, materials = mat(s.wallet.wood, s.wallet.stone);
  const infra = s.character.netWorth - cash - materials - buildings - bridges - s.landValue - pending - goods;
  const xpTable = economy.xp.cumulative[s.mapKind], next = xpTable[s.progress.level + 1];
  const rows: [string, number][] = [['Tiền mặt', cash], ['Gỗ + đá (quy đổi)', materials], ['Công trình', buildings], ['Đường + kè', infra], ['Cầu', bridges], ['Đất đã mở', s.landValue], ['Tiền chờ thu', pending], ['Hàng trong kho', goods]];
  return <div className="profile">
    <p><strong>{s.character.displayName}#{s.character.tag}</strong> · {s.mapKind === 'city' ? 'Thành phố' : 'Quê'}</p>
    <p>Cấp {s.progress.level} · {s.progress.xp.toLocaleString('vi-VN')} XP{next !== undefined ? ` · cần ${(next - s.progress.xp).toLocaleString('vi-VN')} XP để lên cấp` : ' · cấp tối đa'}</p>
    <p>Khu đất đã mở: {s.unlockedZones.length}/64 · Công trình: {s.buildings.length} · Ngày tạo {new Date(s.character.createdAt).toLocaleDateString('vi-VN')}</p>
    <table><tbody>{rows.map(([label, value]) => <tr key={label}><td>{label}</td><td>{money(value)}</td></tr>)}<tr className="total"><td>Tổng tài sản</td><td>{money(s.character.netWorth)}</td></tr></tbody></table>
  </div>;
}
function repeatTitle(q: RepeatQuest): string {
  const name = (key: string | undefined) => (key ? t(key) : '');
  switch (q.template) {
    case 'collect_cash': return `Thu ${money(q.target)} tiền thuê và kinh doanh`;
    case 'build_type': return `Xây ${q.target} ${name(catalog.buildings[q.subject!]?.nameKey)}`;
    case 'road_cells': return `Làm hoặc nâng cấp ${q.target} ô đường`;
    case 'embank_cells': return `Kè ${q.target} ô bờ`;
    case 'population': return `Đạt ${q.target} dân`;
    case 'harvest_crop': return `Thu hoạch ${q.target} ô ${name(catalog.crops[q.subject!]?.nameKey)}`;
    case 'sell_item': return `Bán ${q.target} ${name(catalog.items[q.subject!]?.nameKey)}`;
    case 'produce_item': return `Làm ${q.target} mẻ ở ${name(catalog.buildings[q.subject!]?.nameKey)}`;
    case 'till_cells': return `Cuốc ${q.target} ô đất`;
  }
}
/** docs/09 §5 — "Bác Tư" hints for the authored quests: which tool to use and how. */
const HINTS: Record<string, { tool: Tool; text: string }> = {
  CLEAR: { tool: 'clear', text: 'Chọn Dọn rồi kéo qua vài cái cây để chặt lấy gỗ.' },
  ROAD: { tool: 'road', text: 'Chọn Đường, kéo từ ô đường làng (điểm vào) tới bãi đất trống.' },
  TERRAFORM: { tool: 'terraform', text: 'Chọn San nền → Phẳng, rồi kéo một vùng 2 × 2 ô.' },
  BUILD: { tool: 'build', text: 'Chọn Xây, chọn công trình trong danh sách, đặt cạnh đường.' },
  COLLECT: { tool: 'explore', text: 'Chạm vào công trình có đồng xu vàng để thu tiền.' },
  POPULATION: { tool: 'build', text: 'Xây thêm nhà ở cạnh đường để có thêm dân.' },
  UNLOCK_ZONE: { tool: 'zone', text: 'Chọn Khu đất rồi chạm vào khu sát khu đã mở.' },
  EMBANK: { tool: 'embank', text: 'Chọn Kè rồi chạm vào các ô đất sát mép nước.' },
  BRIDGE: { tool: 'bridge', text: 'Chọn Cầu: chạm đầu cầu (ô đường đã kè) rồi chạm ô bên kia sông.' },
  TILL: { tool: 'till', text: 'Chọn Cuốc rồi kéo một vùng đất bằng phẳng.' },
  PLANT: { tool: 'plant', text: 'Chọn Gieo, chọn giống, kéo qua các ô đã cuốc.' },
  HARVEST: { tool: 'harvest', text: 'Khi cây chín, chọn Thu hoạch rồi kéo qua ruộng.' },
  SELL: { tool: 'explore', text: 'Bấm nút Kho ở trên cùng rồi bán nông sản.' },
  PRODUCE: { tool: 'explore', text: 'Chạm vào chuồng gà rồi bấm Sản xuất (cần có ngô trong kho).' },
};
const SKIP_KEY = 'xay-nha.skipTutorial';
const skipped = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };
export interface GameProps { loader:()=>Promise<WorldStore>; onSwitchMap?:(world:WorldStore)=>void }
export function Game({loader,onSwitchMap}:GameProps){
  const canvas=useRef<HTMLCanvasElement>(null),gameRef=useRef<GameLoop|null>(null);
  const [ready,setReady]=useState(false),[hideHints,setHideHints]=useState(skipped()),[loadingError,setLoadingError]=useState(''),[attempt,setAttempt]=useState(0),[panel,setPanel]=useState<'inventory'|'materials'|'profile'|null>(null),[stats,setStats]=useState<ReturnType<GameLoop['metrics']>|null>(null);
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
  const hint=q&&!hideHints?HINTS[q.action]:undefined;
  const hasBank=!!state&&kind==='city'&&state.snapshot.buildings.some(b=>b.status==='ACTIVE'&&catalog.buildings[b.defId]?.bankCapHours&&access(state,b));
  const toolList=(Object.keys(toolIcons) as Tool[]).filter(tool=>kind==='farm'||!FARM_ONLY.includes(tool));
  const people=state&&kind==='city'?populationAndJobs(state):null;
  const status=connection==='local'?t('offline'):connection==='online'?t('connected'):connection==='syncing'?`${t('syncing')} (${pending})`:`${t('disconnected')} (${pending})`;
  const preview=ui.preview;
  return <main>
    <canvas ref={canvas} aria-label="Bản đồ 3D"/>
    {!ready&&<div className="loading"><h1>Xây Nhà</h1><p>{loadingError||t('loading')}</p>{loadingError&&<button onClick={()=>{setLoadingError('');setAttempt(attempt+1);}}>{t('retry')}</button>}</div>}
    {ready&&state&&<>
      <header className="hud"><div className="brand" role="button" tabIndex={0} title={t('profile')} onClick={()=>setPanel(panel==='profile'?null:'profile')}><span className="brand-icon">⌂</span><div><strong>XÂY NHÀ <small>{kindLabel}</small></strong><span>{state.snapshot.character.displayName}#{state.snapshot.character.tag} · {t('level')} {state.snapshot.progress.level} · {state.snapshot.progress.xp} XP</span></div></div><div className="resources"><strong className="cash">{money(state.snapshot.wallet.cash)}</strong><button onClick={()=>setPanel(panel==='materials'?null:'materials')}>🪵 {state.snapshot.wallet.wood} &nbsp; ◇ {state.snapshot.wallet.stone}</button><span>{t('builders')} {busy}/{builderCapacity(state)}</span>{kind==='farm'?<button onClick={()=>setPanel(panel==='inventory'?null:'inventory')}>{t('storage')} {inventoryCount(state)}/{storageCapacity(state)}</button>:<span>{t('people')} {people?.population??0}/{people?.jobs??0}</span>}{hasBank&&<button onClick={()=>apply('COLLECT',{buildingIds:[]})}>{t('collectAll')}</button>}{onSwitchMap&&<button aria-label={t('switchMap')} title={t('switchMap')} onClick={()=>{const w=gameRef.current?.world;if(w)onSwitchMap(w);}}>🗺</button>}</div><div className="sub-hud"><span>{t('worth')} {money(state.snapshot.character.netWorth)}</span>{kind==='farm'&&<span>{t('fields')} {state.snapshot.crops.length}/{fieldQuota(state)}</span>}<span className={connection==='offline'?'error':''} role="status">{status}</span></div></header>
      {q&&<aside className="quest panel">{hint&&<div className="tutor" role="note"><b>Bác Tư:</b> {hint.text}<button className="link" onClick={()=>{try{localStorage.setItem(SKIP_KEY,'1');}catch{/* storage blocked */}setHideHints(true);}}>{t('skipTutorial')}</button></div>}<small>{t('quests')} {state.snapshot.progress.questIndex+1}/{catalog.quests[kind].length}</small><strong>{t(q.nameKey)}</strong><span>{Math.min(q.target,authoredQuestProgress(state))}/{q.target} · {money(q.reward.cash)} · {q.xp} XP</span><button disabled={authoredQuestProgress(state)<q.target} onClick={()=>apply('CLAIM_QUEST',{questId:q.id})}>{t('claim')}</button></aside>}
      {!q&&state.snapshot.progress.repeat&&<aside className="quest panel repeat"><small>{t('repeatQuests')}</small>{state.snapshot.progress.repeat.active.map(rq=>{const done=repeatQuestProgress(state,rq)>=rq.target,rerollReady=state.snapshot.serverTime>=state.snapshot.progress.repeat!.rerollAt;return <div key={rq.id} className="repeat-quest"><strong>{repeatTitle(rq)}</strong><span>{Math.min(rq.target,repeatQuestProgress(state,rq))}/{rq.target} · {money(rq.reward.cash)} · {rq.xp} XP</span><div className="row"><button disabled={!done} onClick={()=>apply('CLAIM_QUEST',{questId:rq.id})}>{t('claim')}</button><button disabled={!rerollReady} title={rerollReady?'':`${t('rerollIn')} ${duration(state.snapshot.progress.repeat!.rerollAt-state.snapshot.serverTime)}`} onClick={()=>apply('REROLL_QUEST',{questId:rq.id})}>{t('reroll')}</button></div></div>;})}</aside>}
      <div className="camera-buttons"><button aria-label="Phóng to" onClick={()=>gameRef.current?.rig.zoom(-140)}>＋</button><button aria-label="Thu nhỏ" onClick={()=>gameRef.current?.rig.zoom(140)}>−</button><button aria-label={t('resetCamera')} onClick={()=>gameRef.current?.rig.reset()}>⟲</button></div>
      {panel&&<aside className="side panel"><button className="close" onClick={()=>setPanel(null)}>×</button><h2>{t(panel)}</h2>{panel==='profile'?<Profile state={state}/>:panel==='materials'?(['wood','stone'] as const).map(material=><div className="item" key={material}><span>{t(material)}</span>{[1,10].map(count=><button key={count} onClick={()=>apply('BUY_MATERIAL',{[material]:count})}>{t('buy')} {count}</button>)}</div>):Object.entries(state.snapshot.inventory).map(([id,count])=><div className="item" key={id}><span>{t(catalog.items[id]?.nameKey??id)} × {count}</span><button disabled={!count} onClick={()=>apply('SELL',{items:{[id]:count}})}>{t('sell')} {money(count*(catalog.items[id]?.sellPrice??0))}</button></div>)}</aside>}
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
        <nav className="tools panel" aria-label="Công cụ">{toolList.map(tool=><button aria-pressed={ui.tool===tool} className={`${ui.tool===tool?'selected':''} ${hint?.tool===tool&&ui.tool!==tool?'hint':''}`} key={tool} onClick={()=>choose(tool)}><b>{toolIcons[tool]}</b><span>{t(tool)}</span></button>)}</nav><p className="controls">{matchMedia('(pointer:coarse)').matches?t('touchControls'):t('controls')}</p>
      </footer>
      {new URLSearchParams(location.search).get('debug')==='1'&&<pre className="debug">{stats?`${stats.fps.toFixed(1)} FPS · ${stats.drawCalls} calls · ${stats.triangles} triangles\nGPU objects ${stats.geometries} geometries / ${stats.textures} textures / ${stats.programs} programs\nZone ${stats.terrain.lastRebuildMs.toFixed(2)} ms · max ${stats.terrain.maxRebuildMs.toFixed(2)} ms · revision ${stats.revision}\nCell ${ui.cell?.join(',')??'—'}`:''}</pre>}
    </>}
  </main>;
}
