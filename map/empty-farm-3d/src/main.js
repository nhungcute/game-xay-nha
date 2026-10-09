import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {TerrainSystem} from './systems/Terrain.js';
import {WaterSystem} from './systems/Water.js';
import {PathSystem} from './systems/Paths.js';
import {ParcelSystem} from './systems/Parcels.js';
import {VegetationSystem} from './systems/Vegetation.js';
import {BuildingSystem,BUILDING_TYPES,createStructure} from './systems/Buildings.js';

const el=id=>document.getElementById(id);
let world,renderer,scene,camera,controls,terrain,water,paths,parcels,vegetation,buildings;
let currentTool='select',lastPointer=null,rotation=0,selectedParcel=null,ghost=null,lastMessage=0;
const canvas=el('scene'),ray=new THREE.Raycaster(),cursor=new THREE.Vector2(),clock=new THREE.Clock();
const storageKey='verdant_valley_farm_v1';
const mobile=matchMedia('(pointer:coarse)').matches;

function message(text,seconds=4){
  el('message').textContent=text;el('message').classList.add('shown');
  const id=++lastMessage;setTimeout(()=>{if(id===lastMessage)el('message').classList.remove('shown');},seconds*1000);
}
function stat(){el('buildings-stat').textContent=buildings.objects.length;}
function setupScene(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.5:1.85));
  renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.53;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene=new THREE.Scene();scene.background=new THREE.Color(world.environment.sky);scene.fog=new THREE.Fog(world.environment.fog,240,620);
  const aspect=innerWidth/innerHeight,half=aspect<1?195:126;
  camera=new THREE.OrthographicCamera(-half*aspect,half*aspect,half,-half,.1,1200);
  camera.position.set(...world.camera.position);
  const ambient=new THREE.HemisphereLight('#f8ffff','#809357',2.0);scene.add(ambient);
  const sun=new THREE.DirectionalLight('#fff4d8',3.0);sun.position.set(...world.environment.sun);
  sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);
  sun.shadow.camera.left=-156;sun.shadow.camera.right=156;sun.shadow.camera.top=156;sun.shadow.camera.bottom=-156;
  sun.shadow.camera.near=1;sun.shadow.camera.far=380;sun.shadow.normalBias=.055;sun.shadow.bias=-.0001;sun.shadow.radius=2.7;scene.add(sun);
  controls=new OrbitControls(camera,canvas);
  controls.target.set(...world.camera.target);
  controls.enableDamping=true;controls.dampingFactor=.07;
  controls.minPolarAngle=.25;controls.maxPolarAngle=1.43;
  controls.minZoom=.55;controls.maxZoom=3.7;controls.zoomSpeed=1.07;controls.panSpeed=1.2;
  controls.screenSpacePanning=true;controls.enablePan=true;
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  controls.update();
  window.addEventListener('resize',onResize);
}
function onResize(){
  const aspect=innerWidth/innerHeight,half=aspect<1?195:126;
  camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;
  camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
}
function getHits(event,objects,recursive=false){
  const rect=canvas.getBoundingClientRect();
  cursor.set((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height*2-1));
  ray.setFromCamera(cursor,camera);return ray.intersectObjects(objects,recursive);
}
function hoverPosition(event){
  const hits=getHits(event,parcels.meshes);if(!hits.length)return null;
  const hit=hits[0],p=world.parcels.find(x=>x.id===hit.object.userData.parcelId);
  return {x:Math.round(hit.point.x),z:Math.round(hit.point.z),parcel:p};
}
function setTool(type){
  currentTool=type;rotation=0;
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===type));
  if(ghost){scene.remove(ghost);ghost=null;}
  if(type!=='select'){
    ghost=createStructure(type);ghost.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=.48;o.material.depthWrite=false;o.castShadow=false;}});
    ghost.visible=false;scene.add(ghost);message(`${BUILDING_TYPES[type].label}: chạm vào vị trí trống trong lô đất. Q/E để xoay.`);
  }else message('Đang ở chế độ khám phá. Kéo chuột hoặc vuốt để xoay bản đồ.');
}
function handleHover(event){
  if(!ghost)return;
  const hit=hoverPosition(event);
  if(!hit){ghost.visible=false;return;}
  const test=buildings.validate(currentTool,hit.x,hit.z,rotation,hit.parcel);
  ghost.visible=true;ghost.position.set(hit.x,terrain.height(hit.x,hit.z)+.27,hit.z);
  ghost.rotation.y=rotation;
  ghost.traverse(o=>{if(o.isMesh&&o.material.emissive){o.material.emissive.set(test.ok?'#6cf6a0':'#fe685d');o.material.emissiveIntensity=.37;}});
  ghost.userData.valid=test.ok;ghost.userData.reason=test.reason;
}
function handleClick(e){
  if(currentTool==='select'){
    const objects=buildings.group.children;
    const hits=getHits(e,objects,true);
    if(hits.length){const id=hits[0].object.userData.objectId;
      if(id){buildings.select(id);const obj=buildings.objects.find(o=>o.id===id);const p=world.parcels.find(p=>p.id===obj.parcelId);selectParcel(p,true);message(`Đã chọn ${BUILDING_TYPES[obj.type].label} (${obj.id}). Bấm Tháo dỡ để xóa.`);return;}
    }
    const hitsLand=getHits(e,parcels.meshes);
    if(hitsLand.length){const p=world.parcels.find(p=>p.id===hitsLand[0].object.userData.parcelId);selectParcel(p);return;}
    const ground=getHits(e,[terrain.mesh]);if(ground.length)message(`Vị trí địa hình: ${ground[0].point.x.toFixed(1)}, ${ground[0].point.z.toFixed(1)}. Đây là mesh địa hình 3D.`);
    return;
  }
  const hit=hoverPosition(e);
  if(!hit){message('Hãy chọn vị trí nằm bên trong lô đất xây dựng.');return;}
  const v=buildings.validate(currentTool,hit.x,hit.z,rotation,hit.parcel);
  if(!v.ok){message('Không thể xây: '+v.reason);return;}
  const obj=buildings.add({type:currentTool,x:hit.x,z:hit.z,rotation,parcelId:hit.parcel.id});
  stat();selectParcel(hit.parcel);buildings.select(obj.id);
  message(`Đã đặt ${BUILDING_TYPES[currentTool].label} tại ${hit.parcel.id}.`);
  handleHover(e);
}
function selectParcel(p,keepObject=false){
  if(!keepObject)buildings.select(null);
  selectedParcel=p?.id??null;parcels.select(selectedParcel);
  if(p){const [minx,maxx,minz,maxz]=p.points.reduce((b,[x,z])=>[Math.min(b[0],x),Math.max(b[1],x),Math.min(b[2],z),Math.max(b[3],z)],[Infinity,-Infinity,Infinity,-Infinity]);
    el('parcel-info').innerHTML=`<b>${p.name}</b><span>${p.id} · ${p.kind==='soil'?'Đất canh tác':'Thảm cỏ'} · ~${Math.round((maxx-minx)*(maxz-minz))} m²</span>`;
  }else el('parcel-info').innerHTML='<b>Chưa chọn lô đất</b><span>Chạm vào lô đất để xem chi tiết</span>';
}
function bindInteractions(){
  canvas.addEventListener('pointerdown',e=>{lastPointer={x:e.clientX,y:e.clientY,id:e.pointerId,time:performance.now()};});
  canvas.addEventListener('pointerup',e=>{if(!lastPointer||e.pointerId!==lastPointer.id)return;
    const distance=Math.hypot(e.clientX-lastPointer.x,e.clientY-lastPointer.y);
    if(distance<8&&performance.now()-lastPointer.time<600)handleClick(e);lastPointer=null;
  });
  canvas.addEventListener('pointermove',e=>{if(currentTool!=='select'&&(!lastPointer||e.buttons===0))handleHover(e);});
  canvas.addEventListener('pointercancel',()=>{lastPointer=null;});
  document.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>setTool(btn.dataset.tool)));
  el('zoom-in').addEventListener('click',()=>{camera.zoom=Math.min(3.7,camera.zoom*1.22);camera.updateProjectionMatrix();});
  el('zoom-out').addEventListener('click',()=>{camera.zoom=Math.max(.55,camera.zoom/1.22);camera.updateProjectionMatrix();});
  el('rotate-building').addEventListener('click',()=>{if(currentTool==='select'){message('Chọn loại công trình trước khi xoay.');return;}rotation+=Math.PI/2;if(ghost)ghost.rotation.y=rotation;message('Đã xoay hướng công trình 90°.');});
  el('home-camera').addEventListener('click',()=>{controls.target.set(...world.camera.target);camera.position.set(...world.camera.position);camera.zoom=1;camera.updateProjectionMatrix();controls.update();});
  let borders=true;el('toggle-labels').addEventListener('click',()=>{borders=!borders;parcels.setBordersVisible(borders);message(borders?'Hiện ranh giới lô đất':'Đã ẩn ranh giới lô đất');});
  el('remove-btn').addEventListener('click',()=>{if(!buildings.selected){message('Hãy chọn một công trình trước khi tháo dỡ.');return;}
    buildings.remove(buildings.selected);stat();message('Đã tháo dỡ công trình.');});
  el('save-btn').addEventListener('click',()=>{try{localStorage.setItem(storageKey,JSON.stringify(buildings.serialize()));message(`Đã lưu ${buildings.objects.length} công trình vào trình duyệt.`);}catch(e){message('Không thể lưu: '+e.message);}});
  el('load-btn').addEventListener('click',()=>{try{const saved=localStorage.getItem(storageKey);if(!saved){message('Chưa có bản lưu nào.');return;}
    const count=buildings.hydrate(JSON.parse(saved));stat();selectParcel(null);message(`Đã tải bản lưu với ${count} công trình.`);}catch(e){message('Không thể tải: '+e.message);}});
  el('export-btn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(buildings.serialize(),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='verdant-valley-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);message('Đã xuất dữ liệu bản đồ dạng JSON.');});
  el('import-input').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;
    try{if(file.size>2_000_000)throw new Error('File vượt quá 2 MB');const json=JSON.parse(await file.text());const count=buildings.hydrate(json);stat();selectParcel(null);message(`Đã nhập ${count} công trình từ JSON.`);}catch(err){message('Lỗi nhập dữ liệu: '+err.message);}e.target.value='';});
  el('help-btn').addEventListener('click',()=>el('modal').hidden=false);
  el('close-modal').addEventListener('click',()=>el('modal').hidden=true);
  el('modal').addEventListener('click',e=>{if(e.target===el('modal'))el('modal').hidden=true;});
  addEventListener('keydown',e=>{
    if(e.target?.tagName==='INPUT')return;
    if(e.key==='Escape'){setTool('select');el('modal').hidden=true;}
    if(e.key.toLowerCase()==='q' || e.key.toLowerCase()==='e'){
      rotation+=(e.key.toLowerCase()==='q'?-1:1)*Math.PI/2;
      if(ghost){ghost.rotation.y=rotation;message('Đã xoay công trình '+Math.round((rotation*180/Math.PI)%360)+'°.');}
    }
    if(e.key==='Delete'||e.key==='Backspace'){
      if(buildings.selected){buildings.remove(buildings.selected);stat();message('Đã tháo dỡ công trình.');}
    }
  });
}
function animate(){
  requestAnimationFrame(animate);
  controls.update();water.update(clock.getElapsedTime());vegetation.update(camera,controls.target);
  renderer.render(scene,camera);
}
async function main(){
  try{
    const mapId=new URLSearchParams(location.search).get('map')||'farm-valley';
    if(!/^[a-z0-9-]+$/.test(mapId))throw new Error('Invalid map name');
    world=await fetch(`/worlds/${mapId}.json`).then(r=>{if(!r.ok)throw new Error('Cannot load world configuration');return r.json();});
    setupScene();
    terrain=new TerrainSystem(world);scene.add(terrain.group);
    water=new WaterSystem(world,terrain);scene.add(water.group);
    paths=new PathSystem(world,terrain);scene.add(paths.group);
    parcels=new ParcelSystem(world,terrain);scene.add(parcels.group);
    buildings=new BuildingSystem(world,terrain);scene.add(buildings.group);
    vegetation=new VegetationSystem(world,terrain);await vegetation.initialize();scene.add(vegetation.group);
    el('parcels-stat').textContent=world.parcels.length;
    bindInteractions();stat();animate();
    el('loading').classList.add('hide');setTimeout(()=>el('loading').remove(),700);
    window.__farmDebug={world,scene,camera,renderer,controls,terrain,water,paths,parcels,vegetation,buildings,rotateCamera:(radians=Math.PI/2)=>{
      const offset=camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0,1,0),radians);
      camera.position.copy(controls.target).add(offset);controls.update();return camera.position.toArray();},
      summary:()=>({parcelCount:world.parcels.length,buildingCount:buildings.objects.length,vegetationChunks:vegetation.chunks.size,terrainVertices:terrain.mesh.geometry.getAttribute('position').count,waterMeshes:water.group.children.filter(c=>c.name.startsWith('River')||c.name.startsWith('Lake')).length})};
    message('Bản đồ 3D đã sẵn sàng. Hiện có 0 công trình. Xoay camera để khám phá!',5);
  }catch(err){console.error(err);el('loading').innerHTML=`<h2>Không thể khởi tạo bản đồ</h2><p>${String(err.message).replace(/</g,'&lt;')}</p><p>Kiểm tra console và đường dẫn tài nguyên.</p>`;}
}
main();
