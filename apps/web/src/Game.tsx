import { useEffect, useRef, useState } from 'react';
import { catalog, economy } from '@xay-nha/content';
import type { Cell, CommandType } from '@xay-nha/contracts';
import { builderCapacity, fieldQuota, populationAndJobs } from '@xay-nha/sim';
import { AssetManager, type AssetManifestEntry } from './game/assets/AssetManager';
import { GameLoop } from './game/GameLoop';
import { WorldStore, useWorld } from './game/WorldStore';
import { useTools, type Tool } from './game/ToolController';
import { errorText, money, t } from './i18n';
import { GameIcon } from './ui/GameIcon';
import { useOverlayEdge } from './ui/useOverlayEdge';
import { report } from './net/telemetry';
import { BuildingSelection } from './ui/BuildingSelection';
import { MiniMap } from './ui/MiniMap';
import { TopBar, notifications } from './ui/TopBar';
import { MissionPanel } from './ui/MissionPanel';
import { CategoryBar, CategoryTray, categoryOf, type Category } from './ui/CategoryBar';
import type { GamePanel } from './ui/panels';
import { BuildingPanel } from './ui/BuildingPanel';
import { LevelUpCard } from './ui/LevelUp';

function GraphicsSettings({ quality, onChange }: { quality: 'high' | 'low' | undefined; onChange: (quality: 'high' | 'low') => void }) {
  return <div className="settings" role="group" aria-label={t('graphics')}><span>{t('graphics')}</span>
    {(['high', 'low'] as const).map(level => <button type="button" key={level} aria-pressed={quality === level}
      className={quality === level ? 'selected' : ''} onClick={() => onChange(level)}>{t(level === 'high' ? 'graphicsHigh' : 'graphicsLow')}</button>)}
  </div>;
}
function SoundSettings({ muted, onChange }: { muted: boolean | undefined; onChange: (muted: boolean) => void }) {
  return <div className="settings" role="group" aria-label={t('sound')}><span>{t('sound')}</span>
    {([false, true] as const).map(off => <button type="button" key={String(off)} aria-pressed={muted === off}
      className={muted === off ? 'selected' : ''} onClick={() => onChange(off)}>{t(off ? 'soundOff' : 'soundOn')}</button>)}
  </div>;
}
function MusicSettings({ on, onChange }: { on: boolean | undefined; onChange: (on: boolean) => void }) {
  return <div className="settings" role="group" aria-label={t('music')}><span>{t('music')}</span>
    {([true, false] as const).map(value => <button type="button" key={String(value)} aria-pressed={on === value}
      className={on === value ? 'selected' : ''} onClick={() => onChange(value)}>{t(value ? 'soundOn' : 'soundOff')}</button>)}
  </div>;
}
/** D030: attribution for every manifest entry under a Creative Commons license — model, author, license (linked),
 *  source link and the "modified" notice. Read straight from /assets/manifest.json at panel open. */
const LICENSE_URLS: Record<string, string> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};
function AssetCredits() {
  const [credits, setCredits] = useState<AssetManifestEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/assets/manifest.json').then(response => response.json()).then(document => {
      if (!cancelled) setCredits(document.assets.filter((asset: AssetManifestEntry) => typeof asset.license === 'string' && asset.license.startsWith('CC-')));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!credits.length) return null;
  return <div className="settings hud3-credits" role="group" aria-label="Ghi công"><span>Ghi công</span>
    <ul>{credits.map(asset => <li key={asset.id}>
      <strong>{asset.id}</strong> — {asset.author} · <a href={LICENSE_URLS[asset.license] ?? asset.url} target="_blank" rel="noreferrer">{asset.license}</a>
      {' · '}<a href={asset.source} target="_blank" rel="noreferrer">nguồn</a>{asset.modified && ' · đã chỉnh sửa'}
    </li>)}</ul>
  </div>;
}
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
    <p>Khu đất đã mở: {s.unlockedZones.length}/64 · Công trình: {s.buildings.length} · Đội thợ {builderCapacity(state)} · Ngày tạo {new Date(s.character.createdAt).toLocaleDateString('vi-VN')}</p>
    <table><tbody>{rows.map(([label, value]) => <tr key={label}><td>{label}</td><td>{money(value)}</td></tr>)}<tr className="total"><td>Tổng tài sản</td><td>{money(s.character.netWorth)}</td></tr></tbody></table>
  </div>;
}
/** docs/09 §5 — "Bác Tư" hints for the authored quests: which tool to use and how. */
const HINTS: Record<string, { tool: Tool; text: string }> = {
  CLEAR: { tool: 'clear', text: 'Chọn Thiên nhiên → Dọn rồi kéo qua vài cái cây để chặt lấy gỗ.' },
  ROAD: { tool: 'road', text: 'Chọn Đường, kéo từ ô đường làng (điểm vào) tới bãi đất trống.' },
  TERRAFORM: { tool: 'terraform', text: 'Chọn Thiên nhiên → San nền → Phẳng, rồi kéo một vùng 2 × 2 ô.' },
  BUILD: { tool: 'build', text: 'Chọn Công trình, chọn một công trình, đặt cạnh đường.' },
  COLLECT: { tool: 'explore', text: 'Chạm vào ngôi nhà hoặc cửa hàng có đồng đô la xanh bay phía trên, rồi bấm Thu tiền.' },
  POPULATION: { tool: 'build', text: 'Xây thêm nhà ở cạnh đường để có thêm dân.' },
  UNLOCK_ZONE: { tool: 'zone', text: 'Chọn Tiện ích → Khu đất rồi chạm vào khu sát khu đã mở.' },
  EMBANK: { tool: 'embank', text: 'Chọn Đường → Kè rồi chạm vào các ô đất sát mép nước.' },
  BRIDGE: { tool: 'bridge', text: 'Chọn Đường → Cầu: chạm đầu cầu (ô đường đã kè) rồi chạm ô bên kia sông.' },
  TILL: { tool: 'till', text: 'Chọn Nông trại → Cuốc rồi kéo một vùng đất bằng phẳng.' },
  PLANT: { tool: 'plant', text: 'Chọn Nông trại → Gieo, chọn giống, kéo qua các ô đã cuốc.' },
  HARVEST: { tool: 'harvest', text: 'Khi cây chín, chọn Nông trại → Thu hoạch rồi kéo qua ruộng.' },
  SELL: { tool: 'explore', text: 'Bấm ô nông sản trên thanh trên cùng rồi bán hàng.' },
  PRODUCE: { tool: 'explore', text: 'Chạm vào chuồng gà rồi bấm Sản xuất (cần có ngô trong kho).' },
};
const SKIP_KEY = 'xay-nha.skipTutorial';
const skipped = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };
const PANEL_TITLE: Record<GamePanel, string> = { profile: 'Thành tích', materials: 'Vật liệu', inventory: 'Kho nông sản', settings: 'Cài đặt', people: 'Cư dân', notifications: 'Thông báo' };
const PANEL_ICON = { profile: 'trophy', materials: 'wood', inventory: 'inventory', settings: 'settings', people: 'people', notifications: 'mail' } as const;
export interface GameProps { loader:()=>Promise<WorldStore>; onSwitchMap?:(world:WorldStore)=>void|Promise<void>; onLogout?:(world:WorldStore)=>void|Promise<void> }
export function Game({loader,onSwitchMap,onLogout}:GameProps){
  const canvas=useRef<HTMLCanvasElement>(null),gameRef=useRef<GameLoop|null>(null);
  const [ready,setReady]=useState(false),[hideHints,setHideHints]=useState(skipped()),[loadingError,setLoadingError]=useState(''),[attempt,setAttempt]=useState(0),[panel,setPanel]=useState<GamePanel|null>(null),[stats,setStats]=useState<ReturnType<GameLoop['metrics']>|null>(null);
  const [missionsOpen,setMissionsOpen]=useState(()=>!matchMedia('(max-width:700px)').matches),[switchingMap,setSwitchingMap]=useState(false),[category,setCategory]=useState<Category|null>(null),[seen,setSeen]=useState(''),[zones,setZones]=useState(true);
  const {state,message,error,cacheStatus,connection,pending}=useWorld(),ui=useTools();
  const [levelUp,setLevelUp]=useState<number|null>(null),seenLevel=useRef<number|null>(null);
  // Show what a new level unlocks (G4 review) — only for levels gained while playing, not on load.
  useEffect(()=>{const level=state?.snapshot.progress.level;if(level===undefined)return;if(seenLevel.current!==null&&level>seenLevel.current)setLevelUp(level);seenLevel.current=level;},[state?.snapshot.progress.level]);
  const hudRef=useOverlayEdge('--hud-bottom','bottom'),dockRef=useOverlayEdge('--dock-top','top');
  useEffect(()=>{
    let cancelled=false;let game:GameLoop|undefined;let world:WorldStore|undefined;let selection:BuildingSelection|undefined;const assets=new AssetManager();
    const start=async()=>{
      world=await loader();await world.load();await assets.load();
      if(cancelled){assets.dispose();world.dispose();return;}
      game=new GameLoop(canvas.current!,world,assets);selection=new BuildingSelection(game.scene,world,(x,z)=>game!.terrain.sampleHeight(x,z));gameRef.current=game;setReady(true);
    };
    void start().catch(cause=>{const message=cause instanceof Error?cause.message:String(cause);report('load',message,{mapId:world?.state?.template.mapId});assets.dispose();world?.dispose();if(!cancelled)setLoadingError(`${t('loadError')} ${message}`);});
    return()=>{cancelled=true;selection?.dispose();game?.dispose();gameRef.current=null;};
  },[attempt]);
  useEffect(()=>{if(!ready)return;const id=window.setInterval(()=>setStats(gameRef.current?.metrics()??null),1000);return()=>window.clearInterval(id);},[ready]);
  useEffect(()=>{if(ui.selection)setPanel(null);},[ui.selection]);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setPanel(null);useTools.setState({selection:null});setCategory(null);}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
  // Keep the bar's highlighted category in step with tools chosen elsewhere (hints, keyboard).
  useEffect(()=>{if(ui.tool!=='explore'){const next=categoryOf(ui.tool,ui.buildingId);if(next)setCategory(next);}},[ui.tool,ui.buildingId]);
  const apply=(type:CommandType,payload:unknown)=>gameRef.current?.world.apply(type,payload);
  const choose=(tool:Tool)=>{setPanel(null);gameRef.current?.tools.choose(tool);};
  const update=(patch:Partial<typeof ui>)=>{useTools.setState(patch);gameRef.current?.tools.refresh();};
  const selected=state?.snapshot.buildings.find(b=>b.id===ui.selection),bridge=state?.snapshot.bridges.find(b=>b.id===ui.selection),object=selected??bridge;
  const kind=state?.template.mapKind??'farm';
  const q=state?catalog.quests[kind][state.snapshot.progress.questIndex]:undefined;
  const hint=q&&!hideHints?HINTS[q.action]:undefined;
  const hintCategory=hint&&hint.tool!=='explore'?categoryOf(hint.tool,q?.buildingId??ui.buildingId):null;
  // D028: "collect all" is there from the start whenever any business has money waiting.
  const canCollect=!!state&&kind==='city'&&state.snapshot.buildings.some(b=>(b.accrued??0)>=1);
  const alerts=state?notifications(state):[],signature=alerts.join('|');
  const openPanel=(next:GamePanel)=>{gameRef.current?.tools.choose('explore');setCategory(null);if(next==='notifications')setSeen(signature);setPanel(current=>current===next?null:next);};
  const setQuality=(quality:'high'|'low')=>{gameRef.current?.setQuality(quality);setStats(gameRef.current?.metrics()??null);};
  const setMuted=(muted:boolean)=>{gameRef.current?.sound.setMuted(muted);setStats(gameRef.current?.metrics()??null);};
  const setMusic=(on:boolean)=>{gameRef.current?.sound.setMusic(on);setStats(gameRef.current?.metrics()??null);};
  const switchMap=async()=>{
    const world=gameRef.current?.world;if(!world||!onSwitchMap||switchingMap)return;
    setSwitchingMap(true);
    try{await onSwitchMap(world);}catch(cause){world.message(`Không đổi được bản đồ. ${cause instanceof Error?cause.message:'Hãy thử lại.'}`,true);}
    finally{setSwitchingMap(false);}
  };
  const pickCategory=(next:Category)=>{
    setPanel(null);useTools.setState({selection:null});
    if(next===category){setCategory(null);gameRef.current?.tools.choose('explore');return;}
    setCategory(next);if(categoryOf(ui.tool,ui.buildingId)!==next)gameRef.current?.tools.choose('explore');
  };
  const pickBuilding=(defId:string,cell?:Cell)=>{gameRef.current?.tools.choose('build');useTools.setState({buildingId:defId,...(cell?{cell}:{})});gameRef.current?.tools.refresh();};
  const status=connection==='local'?t('offline'):connection==='online'?t('connected'):connection==='syncing'?`${t('syncing')} (${pending})`:`${t('disconnected')} (${pending})`;
  const preview=ui.preview;
  return <main className={`game-shell hud3-shell game-${kind}`}>
    <canvas ref={canvas} aria-label="Bản đồ 3D"/>
    {!ready&&<div className="loading"><h1>AI Farm</h1><p>{loadingError||t('loading')}</p>{loadingError&&<button onClick={()=>{setLoadingError('');setAttempt(attempt+1);}}>{t('retry')}</button>}</div>}
    {ready&&state&&<>
      <TopBar state={state} panel={panel} status={status} connected={connection==='online'||connection==='local'} unread={alerts.length>0&&signature!==seen}
        canCollect={canCollect} onPanel={openPanel} onCollect={()=>apply('COLLECT',{buildingIds:[]})} onMeasure={hudRef}/>
      <MissionPanel state={state} open={missionsOpen} hint={hint?.text} onToggle={()=>setMissionsOpen(!missionsOpen)}
        onSkipHints={()=>{try{localStorage.setItem(SKIP_KEY,'1');}catch{/* storage blocked */}setHideHints(true);}}
        onClaim={id=>apply('CLAIM_QUEST',{questId:id})} onReroll={id=>apply('REROLL_QUEST',{questId:id})} onRelief={()=>apply('CLAIM_RELIEF',{})}
        onChoose={action=>{const tool=HINTS[action]?.tool??'explore';if(tool==='build'&&q?.buildingId)pickBuilding(q.buildingId);else choose(tool);}}/>
      <MiniMap state={state} rig={gameRef.current?.rig}/>
      <div className="hud3-controls" role="group" aria-label="Điều khiển góc nhìn">
        <div className="hud3-zoom"><button type="button" aria-label="Phóng to" onClick={()=>gameRef.current?.rig.zoom(-140)}><GameIcon name="zoomIn"/></button>
        <button type="button" aria-label="Thu nhỏ" onClick={()=>gameRef.current?.rig.zoom(140)}><GameIcon name="zoomOut"/></button>
        <button type="button" aria-label={t('resetCamera')} onClick={()=>gameRef.current?.rig.reset()}><GameIcon name="reset"/></button></div>
        <button className="hud3-layers" type="button" aria-label="Lưới khu đất" aria-pressed={zones} title="Bật/tắt lưới khu đất" onClick={()=>{const next=!zones;gameRef.current?.overlay.setZonesVisible(next);setZones(next);}}><GameIcon name="layers"/></button>
      </div>
      {panel&&<aside className="side panel"><button className="close" aria-label="Đóng bảng" onClick={()=>setPanel(null)}><GameIcon name="close"/></button>
        <h2 className="panel-heading"><GameIcon name={PANEL_ICON[panel]}/>{PANEL_TITLE[panel]}</h2>
        {panel==='profile'?<Profile state={state}/>
          :panel==='settings'?<>{onSwitchMap&&<button type="button" className="hud3-switch" aria-label={t('switchMap')} disabled={switchingMap} onClick={()=>{void switchMap();}}><GameIcon name="maps"/>{switchingMap?'Đang đổi…':t('switchMap')}</button>}
            <GraphicsSettings quality={stats?.quality} onChange={setQuality}/><SoundSettings muted={stats?.muted} onChange={setMuted}/><MusicSettings on={stats?.musicOn} onChange={setMusic}/>
            <AssetCredits/>
            {onLogout&&<button type="button" className="hud3-switch hud3-logout" onClick={()=>{const w=gameRef.current?.world;if(w)void onLogout(w);}}><GameIcon name="close"/>Đăng xuất · {state.snapshot.character.displayName}</button>}
            <p className="hud3-panel-note">{status} · {cacheStatus||'—'}</p></>
          :panel==='notifications'?(alerts.length?<ul className="hud3-notes">{alerts.map(text=><li key={text}>{text}</li>)}</ul>:<p className="empty-inventory"><GameIcon name="mail"/>Chưa có thông báo mới.</p>)
          :panel==='people'?<div className="population-summary"><GameIcon name="people"/>{kind==='city'?<><strong>{populationAndJobs(state).population} cư dân</strong><p>{populationAndJobs(state).jobs} việc làm từ các công trình hiện có.</p><p>Xây thêm nhà để tăng dân số và đáp ứng nhân lực kinh doanh.</p></>:<><strong>{state.snapshot.crops.length}/{fieldQuota(state)} ô ruộng</strong><p>Nhà nông giúp mở rộng diện tích canh tác.</p></>}</div>
          :panel==='materials'?(['wood','stone'] as const).map(material=><div className="item" key={material}><GameIcon name={material}/><span>{t(material)}</span>{[1,10,50].map(count=><button key={count} onClick={()=>apply('BUY_MATERIAL',{[material]:count})}>{t('buy')} {count}</button>)}</div>)
          :Object.keys(state.snapshot.inventory).length?Object.entries(state.snapshot.inventory).filter(([,count])=>count>0).map(([id,count])=>{const price=catalog.items[id]?.sellPrice??0;return <div className="item" key={id}><span>{t(catalog.items[id]?.nameKey??id)} × {count}</span>{[1,10].filter(n=>n<count).map(n=><button key={n} onClick={()=>apply('SELL',{items:{[id]:n}})}>{t('sell')} {n}</button>)}<button onClick={()=>apply('SELL',{items:{[id]:count}})}>{t('sell')} hết · {money(count*price)}</button></div>;})
          :<p className="empty-inventory"><GameIcon name="inventory"/>Kho đang trống. Thu hoạch hoặc thu sản phẩm để thêm hàng vào kho.</p>}
      </aside>}
      {object&&!panel&&<BuildingPanel key={object.id} state={state} building={selected} bridge={bridge} apply={(type,payload)=>{apply(type,payload);}} onClose={()=>update({selection:null})}/>}
      <footer className="hud3-dock" ref={dockRef}>
        <div className="feedback"><span className={error?'error':''} role="status">{message||t('select')}</span><small>{cacheStatus}</small></div>
        {ui.tool!=='explore'&&<div className="tool-options panel"><strong>{ui.tool==='build'?t(catalog.buildings[ui.buildingId]?.nameKey??'build'):t(ui.tool)}</strong>
          {ui.tool==='terraform'&&(['RAISE','LOWER','FLATTEN'] as const).map(mode=><button className={ui.mode===mode?'selected':''} key={mode} onClick={()=>update({mode})}>{t(mode.toLowerCase())}</button>)}
          {ui.tool==='road'&&([1,2,3] as const).map(tier=><button className={ui.tier===tier?'selected':''} key={tier} onClick={()=>update({tier})}>{['Đường đất','Lát đá','Nhựa'][tier-1]}</button>)}
          {ui.tool==='bridge'&&<select value={ui.bridgeId} onChange={e=>update({bridgeId:e.target.value})}>{Object.values(catalog.bridges).map(def=><option key={def.id} value={def.id}>{def.id==='bridge_wood'?'Cầu gỗ':def.id==='bridge_stone'?'Cầu đá':'Cầu bê tông'} · {t('level')} {def.unlockLevel}</option>)}</select>}
          {['road','embank','bridge','till'].includes(ui.tool)&&<label><input type="checkbox" checked={ui.remove} onChange={e=>update({remove:e.target.checked})}/>{t('remove')}</label>}
          {ui.tool==='build'&&<><button onClick={()=>gameRef.current?.tools.rotate()}><GameIcon name="rotate"/>{t('rotate')} {ui.rotation*90}°</button><label><input type="checkbox" checked={ui.autoFlatten} onChange={e=>update({autoFlatten:e.target.checked})}/>San tự động</label></>}
          {ui.tool==='plant'&&<select value={ui.cropId} onChange={e=>update({cropId:e.target.value})}>{Object.values(catalog.crops).map(crop=><option key={crop.id} value={crop.id}>{t(crop.nameKey)} · {money(crop.seedCost)} · {t('level')} {crop.unlockLevel}</option>)}</select>}
          {preview?.note&&<span className="preview-note" role="alert">{preview.note}</span>}<span className={`preview-cost ${preview?.valid?(preview.warning?'warning':'valid'):'error'}`}>{preview?.cost?<>{money(preview.cost.cash)} <GameIcon name="wood"/>{preview.cost.wood} <GameIcon name="stone"/>{preview.cost.stone}</>:preview?.code?errorText(preview.code):t('select')}</span><button className="primary" disabled={!preview?.valid} onClick={()=>gameRef.current?.tools.confirm()}><GameIcon name="confirm"/>{t('confirm')}</button><button onClick={()=>gameRef.current?.tools.cancel()}><GameIcon name="close"/>{t('cancel')}</button>
        </div>}
        {category&&<CategoryTray state={state} category={category} tool={ui.tool} buildingId={ui.buildingId} hintTool={hint?.tool}
          onTool={tool=>choose(tool)} onBuilding={defId=>pickBuilding(defId)}/>}
        <CategoryBar kind={kind} active={category} hintCategory={hintCategory} onCategory={pickCategory} onMeasure={()=>undefined}/>
      </footer>
      {levelUp!==null&&<LevelUpCard kind={kind} level={levelUp} onClose={()=>setLevelUp(null)}/>}
      {new URLSearchParams(location.search).get('debug')==='1'&&<pre className="debug">{stats?`${stats.fps.toFixed(1)} FPS · ${stats.drawCalls} calls · ${stats.triangles} triangles\nGPU objects ${stats.geometries} geometries / ${stats.textures} textures / ${stats.programs} programs\nZone ${stats.terrain.lastRebuildMs.toFixed(2)} ms · max ${stats.terrain.maxRebuildMs.toFixed(2)} ms · ${stats.terrain.zonesRebuilt} rebuilds · revision ${stats.revision}\nQueue ${stats.pending} · clock skew ${Math.round(stats.clockSkewMs)} ms · graphics ${stats.quality}\nCell ${ui.cell?.join(',')??'—'}`:''}</pre>}
    </>}
  </main>;
}
