import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {loadWorld} from './core/world.js';
import {loadSaved,persist,exportJSON,parseSaved} from './core/storage.js';
import {polygonCenter} from './core/math.js';
import {TerrainSystem} from './systems/terrain.js';
import {SurfaceSystem} from './systems/surfaces.js';
import {ParcelSystem} from './systems/parcels.js';
import {NatureSystem} from './systems/nature.js';
import {BuildingSystem,CATALOG} from './systems/buildings.js';

const $=(q)=>document.querySelector(q),canvasWrap=$('#canvas-wrap');
const scene=new THREE.Scene();scene.background=new THREE.Color('#a5dce1');scene.fog=new THREE.FogExp2('#a6d6c4',.00285);
const camera=new THREE.PerspectiveCamera(44,1,.3,650);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.53;
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
canvasWrap.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=26;controls.maxDistance=390;
controls.maxPolarAngle=Math.PI/2.13;controls.minPolarAngle=.16;
controls.enablePan=true;controls.screenSpacePanning=true;controls.zoomSpeed=1.1;controls.rotateSpeed=.57;
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
const hemi=new THREE.HemisphereLight('#e7f5ff','#91a971',2.0);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff4dc',2.8);sun.position.set(-70,128,-70);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-135;sun.shadow.camera.right=135;sun.shadow.camera.top=135;sun.shadow.camera.bottom=-135;sun.shadow.camera.near=10;sun.shadow.camera.far=350;sun.shadow.bias=-.0004;sun.shadow.normalBias=.06;scene.add(sun);
const fill=new THREE.DirectionalLight('#b1ecff',.5);fill.position.set(65,50,105);scene.add(fill);
const worldRoot=new THREE.Group();worldRoot.name='WORLD_GEOMETRY_ROOT';scene.add(worldRoot);
let world,terrain,surfaces,parcels,nature,buildings,active='inspect',selected=null,currentMap='farm',busy=false;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),clock=new THREE.Clock();
let lastN=-1,toastTimer,down=null,lastPick=null;
const isBuild=(m)=>Object.prototype.hasOwnProperty.call(CATALOG,m);
const toast=(s)=>{const el=$('#toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2700);};
const progress=(n,msg)=>{$('#load-progress').style.width=n+'%';$('#load-label').textContent=msg;};
function cameraHome(){if(!world)return;camera.position.set(...world.camera.position);controls.target.set(...world.camera.target);controls.update();}
function resize(){const w=canvasWrap.clientWidth,h=canvasWrap.clientHeight;camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();renderer.setSize(w,h,false);}
window.addEventListener('resize',resize);resize();
function updateInspector(){
  const el=$('#parcel-content');
  if(!selected){el.innerHTML='<div class="none-selected"><div class="illustration">◇</div><strong>No lot selected</strong><p>Tap any empty green or tan parcel to inspect and start building.</p></div>';return;}
  const [x,z]=polygonCenter(selected.points),count=buildings.countFor(selected.id);
  el.innerHTML=`<div class="lot-id">${selected.id}</div><div class="lot-name">${selected.label}</div>
     <span class="lot-chip">● ${selected.type==='cleared'?'Cleared fertile land':'Open green meadow'}</span>
     <div class="lot-row"><span>Buildings</span><b>${count}</b></div>
     <div class="lot-row"><span>Position</span><b>${x.toFixed(0)}, ${z.toFixed(0)}</b></div>
     <div class="lot-row"><span>Access</span><b>Dirt path</b></div>
     <p class="help-text">Choose Cabin, Barn or Garden. Move your cursor across this lot; green = valid placement, red = blocked. Press <b>R</b> to rotate.</p>`;
}
function updateCounters(){if(!world)return;$('#stat-world').textContent=`${world.title.toUpperCase()} · ${world.parcels.length} LOTS`;$('#stat-count').textContent=`${buildings.placed.length} BUILDINGS`;
  if(selected)updateInspector();}
function saveState(){return {schemaVersion:1,mapId:currentMap,seed:world.seed,savedAt:new Date().toISOString(),buildings:buildings.placed,nature:nature.exportState()};}
function saveLocal(announce=false){if(!world)return;try{persist(currentMap,saveState());if(announce)toast('World state saved on this device');}catch(e){toast('Save error: '+e.message);}}
function selectParcel(obj){selected=obj;parcels.select(obj);updateInspector();}
function tool(mode){active=mode;document.querySelectorAll('[data-tool]').forEach(el=>el.classList.toggle('is-active',el.dataset.tool===mode));buildings?.setGhost(isBuild(mode)?mode:null);toast(mode==='inspect'?'Explore the terrain and select a lot':isBuild(mode)?`Select a lot and place a ${CATALOG[mode].label.toLowerCase()}`:mode==='plant'?'Tap on natural land to plant an oak':mode==='clear'?'Tap near a tree to remove it':'Tap a building to demolish');}
function clearWorld(){
  if(!world)return;
  selectParcel(null);nature.dispose();buildings.dispose();terrain.dispose();surfaces.dispose();parcels.dispose();
  worldRoot.clear();world=null;
}
async function start(id){
  if(busy)return;busy=true;$('#loading').classList.remove('hidden');$('#error-screen').hidden=true;
  progress(8,'Reading world configuration');
  try{
    clearWorld();currentMap=id;world=await loadWorld(id);
    progress(21,'Generating elevated terrain mesh');
    terrain=new TerrainSystem(world);worldRoot.add(terrain.mesh);
    progress(40,'Cutting lakes and meandering waterways');
    surfaces=new SurfaceSystem(world,terrain);worldRoot.add(surfaces.group);
    progress(52,'Mapping buildable land parcels');
    parcels=new ParcelSystem(world,terrain);worldRoot.add(parcels.group);
    buildings=new BuildingSystem(world,terrain);worldRoot.add(buildings.group);
    progress(63,'Loading original GLB nature assets');
    nature=new NatureSystem(world,terrain);worldRoot.add(nature.group);
    let loaded=0;await nature.load(()=>{loaded++;progress(63+Math.floor(loaded/7*29),`Instancing nature assets (${loaded}/7)`);});
    progress(94,'Restoring saved changes');
    const s=loadSaved(id);if(s?.schemaVersion===1&&s.seed===world.seed){nature.importState(s.nature);buildings.load(s.buildings);}
    cameraHome();tool('inspect');updateCounters();$('#world-select').value=id;
    resize();progress(100,'Ready to explore');
    $('#loading').classList.add('hidden');
    window.__mapDebug=()=>({mapId:currentMap,geometry:true,terrainVertices:terrain.mesh.geometry.getAttribute('position').count,lakes:surfaces.group.children.filter(o=>o.name.startsWith('LAKE_')).length,rivers:surfaces.group.children.filter(o=>o.name.startsWith('RIVER_')).length,instancedMeshes:nature.group.children.reduce((n,c)=>n+c.children.filter(m=>m.isInstancedMesh).length,0),instancedElements:nature.total,parcels:world.parcels.length,buildings:buildings.placed.length,selectedId:selected?.id||null,cameraPosition:camera.position.toArray(),projectParcel:(id)=>{const p=world.parcels.find(p=>p.id===id);if(!p)return null;const [x,z]=p.points.reduce((a,b)=>[a[0]+b[0]/p.points.length,a[1]+b[1]/p.points.length],[0,0]);const v=new THREE.Vector3(x,terrain.height(x,z),z).project(camera);return {x:(v.x+1)*canvasWrap.clientWidth/2,y:(1-v.y)*canvasWrap.clientHeight/2};},cameraOrbit:()=>{camera.position.set(95,120,-170);controls.update();return camera.position.toArray();}});
  }catch(err){console.error(err);$('#error-screen').hidden=false;$('#error-detail').textContent=err.message;$('#loading').classList.add('hidden');}
  finally{busy=false;}
}
function hitTerrain(event){
  if(!world)return null;
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObject(terrain.mesh,false);return hits.length?hits[0].point:null;
}
function handleClick(event){
  if(!world||busy)return;
  const hit=hitTerrain(event);if(!hit)return;
  const x=Math.round(hit.x*2)/2,z=Math.round(hit.z*2)/2,parcel=terrain.atParcel(x,z);
  if(isBuild(active)){
    if(!selected||selected.id!==parcel?.id){selectParcel(parcel);if(!parcel)toast('Click a buildable green or tan lot first');return;}
    const res=buildings.place(active,x,z,selected);
    if(res.error)toast(res.error);else{updateCounters();saveLocal();toast(`${CATALOG[active].label} constructed on ${selected.label}`);}
  }else if(active==='demolish'){
    if(buildings.removeAt(x,z)){saveLocal();updateCounters();toast('Structure demolished');}else toast('No structure here');
  }else if(active==='clear'){
    if(nature.clearAt(x,z)){saveLocal();toast('Tree removed');}else toast('Tap closer to a tree');
  }else if(active==='plant'){
    if(nature.plantAt(x,z)){saveLocal();toast('New oak planted');}else toast('Plant on unoccupied natural ground');
  }else{selectParcel(parcel);if(parcel)toast(`${parcel.label} selected · ${parcel.id}`);}
}
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<6)handleClick(e);down=null;});
renderer.domElement.addEventListener('pointermove',e=>{
  if(!world||!isBuild(active)||down)return;
  const v=hitTerrain(e);if(!v){buildings.hideGhost();return;}
  const x=Math.round(v.x*2)/2,z=Math.round(v.z*2)/2;
  buildings.moveGhost(active,x,z,selected);
});
renderer.domElement.addEventListener('pointerleave',()=>buildings?.hideGhost());
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>tool(b.dataset.tool)));
$('#home').addEventListener('click',cameraHome);
$('#rotate').addEventListener('click',()=>{if(!buildings)return;buildings.rotation=(buildings.rotation+90)%360;toast(`Placement rotation: ${buildings.rotation}°`);});
$('#save').addEventListener('click',()=>saveLocal(true));
$('#export').addEventListener('click',()=>{if(world)exportJSON(saveState(),`verdant-${currentMap}-save.json`);});
$('#import').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f||!world)return;
  try{const state=parseSaved(await f.text(),currentMap);nature.importState(state.nature);buildings.load(state.buildings);saveLocal();updateCounters();toast('World state imported successfully');}catch(err){toast(err.message);}finally{e.target.value='';}
});
$('#world-select').addEventListener('change',e=>{saveLocal();start(e.target.value);});
window.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea,select'))return;
  if(e.key==='Escape')tool('inspect');
  if(e.key==='1')tool('cabin');if(e.key==='2')tool('barn');if(e.key==='3')tool('garden');
  if(e.key.toLowerCase()==='r'&&buildings){buildings.rotation=(buildings.rotation+90)%360;toast(`Placement rotation ${buildings.rotation}°`);}
  if(e.key.toLowerCase()==='s'&&(e.ctrlKey||e.metaKey)){e.preventDefault();saveLocal(true);}
});
function animate(){requestAnimationFrame(animate);controls.update();
  if(nature&&world&&nature.assets.size===7){const n=Math.floor(clock.getElapsedTime()*1.2);if(n!==lastN){nature.updateChunks(controls.target);lastN=n;}}
  renderer.render(scene,camera);
}
start('farm');animate();
