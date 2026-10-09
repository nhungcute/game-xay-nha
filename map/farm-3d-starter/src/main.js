import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {WorldField} from './core/WorldField.js';
import {TerrainSystem} from './systems/TerrainSystem.js';
import {WaterSystem} from './systems/WaterSystem.js';
import {PathsSystem} from './systems/PathsSystem.js';
import {VegetationSystem} from './systems/VegetationSystem.js';
import {ParcelsSystem} from './systems/ParcelsSystem.js';
import {ConstructionSystem,TYPES} from './systems/ConstructionSystem.js';
import {renderShell,toast,setMode,inspect} from './ui/ui.js';
import './styles.css';

const qs=new URLSearchParams(location.search);
const preset=['farm','city','eco'].includes(qs.get('world'))?qs.get('world'):'farm';
renderShell();
let ctx;
const html={status:document.querySelector('#build-status'),counter:document.querySelector('#structure-count'),performance:document.querySelector('#system-stats')};
async function boot(){
 const response=await fetch(`/worlds/${preset}.json`,{cache:'no-store'});
 if(!response.ok)throw new Error(`Could not fetch ${preset}.json: HTTP ${response.status}`);
 const config=await response.json();validateConfig(config);
 document.querySelector('#world-name').textContent=config.title;
 document.querySelector('#world-type').textContent=`${config.kind.toUpperCase()} WORLD`;
 document.querySelector('#lot-count').textContent=String(config.parcels.length);
 const canvas=document.querySelector('#game-canvas');
 const isMobile=window.matchMedia('(pointer: coarse)').matches;
 const renderer=new THREE.WebGLRenderer({canvas,antialias:!isMobile,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,isMobile?1.25:1.65));renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.27;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#b5dfd4');scene.fog=new THREE.Fog('#b6d7ce',235,560);
 const hemi=new THREE.HemisphereLight('#f3f8df','#8f9f85',2.7);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#fff3cf',2.45);sun.position.set(-90,180,-65);
 sun.castShadow=true;sun.shadow.mapSize.set(isMobile?1024:2048,isMobile?1024:2048);sun.shadow.camera.left=-185;sun.shadow.camera.right=185;sun.shadow.camera.top=170;sun.shadow.camera.bottom=-170;sun.shadow.camera.near=.5;sun.shadow.camera.far=390;sun.shadow.bias=-.0018;sun.shadow.normalBias=.055;scene.add(sun);scene.add(sun.target);
 const camera=new THREE.OrthographicCamera(-155,155,92,-92,.5,1100);
 const controls=new OrbitControls(camera,canvas);
 controls.enableDamping=true;controls.dampingFactor=.075;controls.screenSpacePanning=true;
 controls.minPolarAngle=.16;controls.maxPolarAngle=Math.PI*.466;
 controls.minZoom=.62;controls.maxZoom=3.8;
 controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
 controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
 controls.target.set(-10,0,6);camera.position.set(158,176,185);camera.zoom=1;
 const field=new WorldField(config);
 const terrain=new TerrainSystem(scene,field);const water=new WaterSystem(scene,field);
 const paths=new PathsSystem(scene,field);
 const vegetation=new VegetationSystem(scene,field);const parcels=new ParcelsSystem(scene,field);
 const construction=new ConstructionSystem(scene,field,vegetation);
 const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2();
 let panChange=true,down=null,lastChunks=0,frame=0,now=performance.now();
 const viewHeight=265;
 function resize(){
   const w=canvas.clientWidth,h=canvas.clientHeight,aspect=w/Math.max(1,h);
   camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;
   camera.updateProjectionMatrix();renderer.setSize(w,h,false);
 }
 window.addEventListener('resize',resize);resize();
 function updateChunks(force=false){
  if(!force&&!panChange&&performance.now()-lastChunks<650)return;
  panChange=false;lastChunks=performance.now();
  const radius=Math.max(96,Math.min(285,350/camera.zoom));
  let keys=terrain.update(controls.target,radius);vegetation.update(keys);
  const stat=vegetation.stats();html.performance.textContent=`3D GEOMETRY  ·  ${stat.instances.toLocaleString()} ASSETS  ·  ${stat.chunks} CHUNKS`;
 }
 controls.addEventListener('change',()=>{panChange=true;});
 function pointFor(event){
  const r=canvas.getBoundingClientRect();mouse.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
  raycaster.setFromCamera(mouse,camera);let hits=raycaster.intersectObjects(terrain.getPickables(),false);
  return hits.length?hits[0].point:null;
 }
 function selectAt(pt){
  const parcel=pt?field.parcelAt(pt.x,pt.z):null;parcels.select(parcel);inspect(parcel,parcels.details(parcel));
  if(parcel)toast(`${parcel.id} · ${parcel.name}`);
 }
 function moveAt(event){
  if(!construction.mode)return;let point=pointFor(event);
  if(!point){if(construction.preview)construction.preview.visible=false;return;}
  const v=construction.updateHover(point.x,point.z);
  html.status.textContent=v?.reason||'Point at a buildable parcel';html.status.style.color=v?.valid?'#c9f4bb':'#ffb6a8';
 }
 canvas.addEventListener('contextmenu',event=>event.preventDefault());
 canvas.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY,t:performance.now()};});
 canvas.addEventListener('pointermove',event=>{if(event.buttons===0||event.pointerType==='touch')moveAt(event);});
 canvas.addEventListener('pointerup',event=>{
  if(!down)return;
  const distance=Math.hypot(event.clientX-down.x,event.clientY-down.y);down=null;
  if(distance>8||event.button!==0)return;
  const pt=pointFor(event);if(!pt)return;
  if(construction.mode){let result=construction.place(pt.x,pt.z);
    if(result.valid){parcels.select(field.parcelAt(pt.x,pt.z));inspect(parcels.selected,parcels.details(parcels.selected));html.counter.textContent=String(construction.objects.length);toast(`${TYPES[construction.mode].label} placed in ${result.parcel}`);}
    else toast(result.reason,true);
    moveAt(event);
  }else selectAt(pt);
 });
 canvas.addEventListener('pointerleave',()=>{if(construction.preview)construction.preview.visible=false;});
 function setTool(type){construction.configure(type);setMode(type);html.status.style.color='';}
 function moveCamera(top=false){
   controls.target.set(-10,0,6);
   camera.position.copy(top?new THREE.Vector3(-10,245,6):new THREE.Vector3(158,176,185));
   camera.zoom=top?1.04:1;camera.updateProjectionMatrix();controls.update();updateChunks(true);
   document.querySelectorAll('.rail-btn').forEach(e=>e.classList.toggle('active',e.dataset.action===(top?'top':'iso')));
 }
 function saveKey(){return `wildlands.${config.id}.save.v1`;}
 function exportSave(){const data=JSON.stringify(construction.save(),null,2),url=URL.createObjectURL(new Blob([data],{type:'application/json'}));let a=document.createElement('a');a.href=url;a.download=`${config.id}-save.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('Downloaded a portable JSON world save');}
 function restore(state){const n=construction.restore(state);html.counter.textContent=n;toast(`Loaded ${n} constructions`);}
 const actions={
  iso:()=>moveCamera(false),top:()=>moveCamera(true),resetCamera:()=>moveCamera(false),
  toggleZones:()=>{parcels.setOutlines(!parcels.visible);document.querySelector('#zones-button').classList.toggle('active',parcels.visible);toast(parcels.visible?'Parcel boundaries visible':'Parcel boundaries hidden');},
  rotateBuild:()=>{if(!construction.mode)return toast('Select a construction tool first');construction.rotate();toast('Rotated footprint 90°');},
  save:()=>{localStorage.setItem(saveKey(),JSON.stringify(construction.save()));toast(`Saved ${construction.objects.length} constructions to this browser`);},
  load:()=>{let data=localStorage.getItem(saveKey());if(!data)return toast('No local save found for this world',true);try{restore(JSON.parse(data));}catch(e){toast(e.message,true);}},
  export:exportSave,import:()=>document.querySelector('#import-file').click(),
  help:()=>document.querySelector('#help-modal').hidden=false,
  closeHelp:()=>document.querySelector('#help-modal').hidden=true
 };
 document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>actions[button.dataset.action]?.()));
 document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool==='select'?null:button.dataset.tool)));
 window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!document.querySelector('#help-modal').hidden)actions.closeHelp();else setTool(null);}if(e.key.toLowerCase()==='r'&&!e.repeat)actions.rotateBuild();});
 document.querySelector('#import-file').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{if(f.size>2_000_000)throw new Error('Import is too large');restore(JSON.parse(await f.text()));}catch(err){toast(err.message,true);}e.target.value='';
 });
 document.querySelector('#help-modal').addEventListener('click',event=>{if(event.target.id==='help-modal')actions.closeHelp();});
 ctx={scene,renderer,camera,controls,field,terrain,water,paths,vegetation,parcels,construction,config,
  getStatus:()=>({preset,buildings:construction.objects.length,parcels:config.parcels.length,chunks:terrain.active.size,glb:vegetation.assets.size,rotation:camera.position.clone().sub(controls.target).toArray(),realGeometry:terrain.pickables?.length>0}),
  rotateTest:()=>{const before=camera.position.clone();camera.position.set(-170,145,140);controls.update();updateChunks(true);return{before:before.toArray(),after:camera.position.toArray(),terrainMeshes:terrain.pickables?.length||terrain.getPickables().length};},
  validateAt:(x,z,type='crop')=>construction.validate(x,z,type),selectAt:(x,z)=>selectAt({x,z}),setTool,placeAt:(x,z)=>construction.place(x,z),save:()=>construction.save(),restore
 };
 // This diagnostic reference is provided for automated e2e browser verification.
 window.__FARM_WORLD_DEBUG__=ctx;
 updateChunks(true);
 try{await vegetation.load();vegetation.update(terrain.active);updateChunks(true);}catch(err){console.error('Asset load error',err);toast('Some optional vegetation assets could not load',true);}
 function animate(){requestAnimationFrame(animate);const tick=performance.now(),dt=Math.min((tick-now)/1000,.08);now=tick;controls.update();water.update(dt);if((frame++%28)===0)updateChunks();renderer.render(scene,camera);}
 animate();
 console.info('Wildlands world started',ctx.getStatus());
}
function validateConfig(c){
 if(c?.schemaVersion!==1||!c.id||!Number.isFinite(c.seed)||!c.world||!Array.isArray(c.parcels)||!Array.isArray(c.paths)||!Array.isArray(c.lakes)||!c.river?.points)throw new Error('Invalid world JSON configuration');
 const seen=new Set();for(const p of c.parcels){if(!p.id||seen.has(p.id)||!Array.isArray(p.polygon)||p.polygon.length<3)throw new Error('Duplicate or invalid parcel ID');seen.add(p.id);}
}
boot().catch(error=>{console.error(error);html.performance.textContent='WORLD LOAD FAILED';toast(error.message,true);});
