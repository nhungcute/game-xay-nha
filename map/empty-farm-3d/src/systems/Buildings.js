import * as THREE from 'three';
import {validatePlacement,sanitizeSave} from '../core/math.js';

export const BUILDING_TYPES={
  field:{label:'Đất trồng',halfX:3.2,halfZ:3.2},
  orchard:{label:'Vườn cây',halfX:4,halfZ:4},
  cottage:{label:'Nhà ở',halfX:4.4,halfZ:4},
  barn:{label:'Chuồng trại',halfX:5.5,halfZ:4.8}
};
const mats={wood:new THREE.MeshStandardMaterial({color:'#bd8553',roughness:.85}),roof:new THREE.MeshStandardMaterial({color:'#9f563e',roughness:.87}),cream:new THREE.MeshStandardMaterial({color:'#f0d3a1',roughness:.89}),white:new THREE.MeshStandardMaterial({color:'#e6e7bb',roughness:1}),dark:new THREE.MeshStandardMaterial({color:'#5f4d40',roughness:1}),green:new THREE.MeshStandardMaterial({color:'#5caa42',roughness:1}),earth:new THREE.MeshStandardMaterial({color:'#a77344',roughness:1}),leaf:new THREE.MeshStandardMaterial({color:'#66b952',roughness:.98})};

function part(parent,geometry,material,x,y,z,rot=0){
  const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.rotation.y=rot;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function box(parent,w,h,d,material,x,y,z){return part(parent,new THREE.BoxGeometry(w,h,d),material,x,y,z);}
function roof(parent,w,d,h,material,y){
  // Roof with real pitched triangular faces, not a sprite.
  const verts=[-w/2,0,-d/2,w/2,0,-d/2,0,h,-d/2,-w/2,0,d/2,w/2,0,d/2,0,h,d/2];
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex([0,1,2,5,4,3,0,2,5,0,5,3,1,4,5,1,5,2,0,3,4,0,4,1]);geo.computeVertexNormals();
  geo.computeVertexNormals();const roofMesh=part(parent,geo,material,0,y,0);roofMesh.material.side=THREE.DoubleSide;return roofMesh;
}
export function createStructure(type){
  const root=new THREE.Group();root.name=`Editable ${type} geometry`;
  if(type==='field'){
    box(root,6.35,.22,6.35,mats.earth,0,.12,0);
    for(let i=-2;i<=2;i++)box(root,5.6,.17,.42,mats.wood,0,.28,i*1.08);
  }else if(type==='orchard'){
    box(root,7.7,.17,7.7,mats.earth,0,.1,0);
    for(const x of [-2.4,2.4])for(const z of [-2.4,2.4]){
      part(root,new THREE.CylinderGeometry(.19,.28,1.65,7),mats.wood,x,1,z);
      const crown=part(root,new THREE.IcosahedronGeometry(1.28,1),mats.leaf,x,2.55,z);
      crown.scale.set(1.12,.92,1.07);
    }
  }else if(type==='cottage'){
    box(root,8,4.0,6.7,mats.cream,0,2.1,0);
    roof(root,9.2,7.65,2.65,mats.roof,4.15);
    box(root,1.3,2.3,.15,mats.wood,-1.35,1.28,3.45);
    for(const x of [1.3,3.1])box(root,1.08,1.12,.17,mats.dark,x,2.52,3.45);
    box(root,1.2,1.1,1.2,mats.wood,-2.5,5.17,-1.1);
  }else if(type==='barn'){
    box(root,10,5,8.1,mats.wood,0,2.55,0);
    roof(root,11.6,9.1,2.6,mats.roof,5.1);
    box(root,3.6,3.9,.17,mats.dark,0,2.0,4.14);
    for(const x of [-3.1,3.1])box(root,1.2,1.3,.17,mats.white,x,3.38,4.14);
    box(root,1.2,1.0,.35,mats.cream,0,5.17,4.14);
  }else throw new Error(`Unknown type ${type}`);
  root.traverse(o=>{if(o.isMesh){o.userData.buildingPart=true;}});
  return root;
}

export class BuildingSystem {
  constructor(world,terrain){
    this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='User-placed buildings (empty on startup)';
    this.objects=[];this.nodes=new Map();this.selected=null;this.counter=0;
  }
  validate(type,x,z,rotation,parcel){
    const b=BUILDING_TYPES[type];if(!b)return {ok:false,reason:'Công trình không hợp lệ.'};
    return validatePlacement({x,z,halfX:b.halfX,halfZ:b.halfZ,rotation},parcel,this.world,this.objects);
  }
  add({id,type,x,z,rotation,parcelId},skipCheck=false){
    const meta=BUILDING_TYPES[type],parcel=this.world.parcels.find(p=>p.id===parcelId);
    if(!meta||!parcel)throw new Error('Loại công trình hoặc lô đất không hợp lệ.');
    const verdict=this.validate(type,x,z,rotation,parcel);
    if(!skipCheck&&!verdict.ok)throw new Error(verdict.reason);
    const uid=id || `OBJ-${String(++this.counter).padStart(5,'0')}`;
    if(this.nodes.has(uid))throw new Error('Trùng ID công trình');
    const node=createStructure(type);
    node.position.set(x,this.terrain.height(x,z)+.25,z);node.rotation.y=rotation;
    node.traverse(o=>{if(o.isMesh)o.material=o.material.clone();});
    node.userData.objectId=uid;node.traverse(o=>{o.userData.objectId=uid;});
    this.group.add(node);this.nodes.set(uid,node);
    const obj={id:uid,type,x,z,rotation,parcelId,halfX:meta.halfX,halfZ:meta.halfZ};this.objects.push(obj);return obj;
  }
  remove(id){const node=this.nodes.get(id);if(!node)return false;this.group.remove(node);node.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});this.nodes.delete(id);this.objects=this.objects.filter(o=>o.id!==id);if(this.selected===id)this.selected=null;return true;}
  select(id){this.selected=id;for(const [uid,node] of this.nodes){node.traverse(o=>{if(o.isMesh&&o.material&&o.material.emissive){o.material.emissive.setHex(uid===id?0x2d5527:0);o.material.emissiveIntensity=uid===id?.23:0;}});}}
  clear(){for(const id of [...this.nodes.keys()])this.remove(id);this.counter=0;}
  serialize(){return {schemaVersion:1,worldId:this.world.id,seed:this.world.seed,objects:this.objects.map(({id,type,x,z,rotation,parcelId})=>({id,type,x,z,rotation,parcelId}))};}
  hydrate(data){
    const parsed=sanitizeSave(data,this.world);this.clear();
    for(const obj of parsed)this.add(obj,true);
    this.counter=Math.max(this.counter,...parsed.map(o=>Number(o.id.split('-').at(-1))||0),0);
    return parsed.length;
  }
}
