import * as THREE from 'three';
import {insideFootprint,rectsOverlap,pointInPoly} from '../core/math.js';
export const CATALOG={
  cabin:{label:'Woodland cabin',width:7,depth:6,cost:'7 × 6',emoji:'⌂'},
  barn:{label:'Timber barn',width:10,depth:8,cost:'10 × 8',emoji:'▣'},
  garden:{label:'Vegetable garden',width:8,depth:7,cost:'8 × 7',emoji:'♧'},
};
const mat=(c)=>new THREE.MeshStandardMaterial({color:c,roughness:.83});
function box(group,size,pos,material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;}
export function makeStructure(type,ghost=false){
  const g=new THREE.Group();
  const wood=mat('#aa774a'),darkWood=mat('#775337'),wall=mat('#eacb93'),roof=mat(type==='barn'?'#8c514b':'#658e60'),dirt=mat('#99744b');
  if(type==='garden'){
    box(g,[8,.24,7],[0,.13,0],dirt);
    for(let j=-2;j<=2;j++){
      box(g,[6,.25,.42],[0,.37,j*1.16],mat(j%2?'#689342':'#75a14a'));
      for(let i=-3;i<=3;i++){
        const plant=new THREE.Mesh(new THREE.IcosahedronGeometry(.31,0),mat((i+j)%2?'#459c4d':'#3d8d4a'));
        plant.position.set(i*.85,.65,j*1.16);g.add(plant);
      }
    }
    for(const x of [-3.85,3.85])box(g,[.23,.48,7],[x,.35,0],wood);
  }else{
    const w=type==='barn'?10:7,d=type==='barn'?8:6,h=type==='barn'?5:3.4;
    box(g,[w,.36,d],[0,.20,0],darkWood);
    box(g,[w*.94,h,d*.92],[0,.38+h/2,0],type==='barn'?wood:wall);
    // real sloping 3D roof geometry with pitched triangular profile
    const roofGeo=new THREE.BufferGeometry();
    const halfW=w*.56, halfD=d*.56,baseY=h+.38,topY=baseY+(type==='barn'?2.45:2.15);
    const V=[-halfW,baseY,-halfD,0,topY,-halfD,halfW,baseY,-halfD,-halfW,baseY,halfD,0,topY,halfD,halfW,baseY,halfD];
    roofGeo.setAttribute('position',new THREE.Float32BufferAttribute(V,3));
    roofGeo.setIndex([0,1,3,1,4,3,1,2,4,2,5,4,0,2,1,3,4,5]);roofGeo.computeVertexNormals();
    const r=new THREE.Mesh(roofGeo,new THREE.MeshStandardMaterial({color:type==='barn'?'#964e3a':'#527d51',roughness:.87,side:THREE.DoubleSide}));r.castShadow=true;g.add(r);
    box(g,[w*.21,h*.57,.13],[0,.4+h*.285,d*.468],darkWood);
    if(type==='cabin'){
      for(const x of [-w*.30,w*.30])box(g,[.85,.85,.13],[x,1.9,d*.475],mat('#b8e3cb'));
      const chimney=box(g,[.75,2,.78],[w*.27,topY-.5,0],mat('#977b68'));chimney.castShadow=true;
    }
  }
  if(ghost){g.traverse(o=>{if(o.isMesh){o.material=new THREE.MeshBasicMaterial({color:'#a9f78f',transparent:true,opacity:.53,depthWrite:false,side:THREE.DoubleSide});o.castShadow=false;}});}
  return g;
}
export class BuildingSystem {
  constructor(world,terrain){this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='USER_BUILT_3D_OBJECTS';this.placed=[];this.nodes=new Map();this.ghost=null;this.rotation=0;}
  validate(type,x,z,parcel,rotation=this.rotation){
    const def=CATALOG[type];if(!def)return 'Unknown structure';
    if(!parcel)return 'Select a buildable lot first';
    const w=rotation%180?def.depth:def.width,d=rotation%180?def.width:def.depth;
    if(!insideFootprint(x,z,w/2+.7,d/2+.7,parcel.points,0))return 'Outside selected lot';
    const offsets=[[0,0],[-w/2,-d/2],[-w/2,d/2],[w/2,-d/2],[w/2,d/2]];
    for(const [dx,dz] of offsets){const xx=x+dx,zz=z+dz;if(this.terrain.containsWater(xx,zz,1.1))return 'Too close to water';if(this.terrain.slope(xx,zz)>.95)return 'Ground too steep';}
    const b={type,x,z,width:def.width,depth:def.depth,rotation};
    if(this.placed.some(p=>rectsOverlap(p,b,1.35)))return 'Overlaps another structure';
    return null;
  }
  setGhost(type){
    if(this.ghost){this.group.remove(this.ghost);this.ghost.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.ghost=null;}
    if(type){this.ghost=makeStructure(type,true);this.ghost.visible=false;this.group.add(this.ghost);}
  }
  moveGhost(type,x,z,parcel){
    if(!this.ghost)return;
    this.ghost.visible=true;this.ghost.position.set(x,this.terrain.height(x,z)+.08,z);
    this.ghost.rotation.y=this.rotation*Math.PI/180;
    const ok=!this.validate(type,x,z,parcel);
    this.ghost.traverse(o=>{if(o.isMesh)o.material.color.set(ok?'#9aff8f':'#ff8181');});
    return ok;
  }
  hideGhost(){if(this.ghost)this.ghost.visible=false;}
  place(type,x,z,parcel){
    const error=this.validate(type,x,z,parcel);if(error)return {error};
    const obj={id:`building-${Date.now()}-${Math.floor(Math.random()*10000)}`,parcelId:parcel.id,type,x,z,rotation:this.rotation,width:CATALOG[type].width,depth:CATALOG[type].depth};
    this.add(obj);return {obj};
  }
  add(obj){
    if(!CATALOG[obj.type])return;
    const m=makeStructure(obj.type);m.position.set(obj.x,this.terrain.height(obj.x,obj.z)+.08,obj.z);
    m.rotation.y=(obj.rotation||0)*Math.PI/180;m.userData.buildingId=obj.id;this.group.add(m);
    this.placed.push(obj);this.nodes.set(obj.id,m);
  }
  removeAt(x,z){
    const hit=this.placed.findLast(b=>Math.abs(b.x-x)<b.width/2&&Math.abs(b.z-z)<b.depth/2);
    if(!hit)return false;
    const node=this.nodes.get(hit.id);if(node){this.group.remove(node);node.traverse(o=>{if(o.isMesh){o.geometry?.dispose();o.material?.dispose();}});this.nodes.delete(hit.id);}
    this.placed=this.placed.filter(b=>b.id!==hit.id);return true;
  }
  countFor(parcelId){return this.placed.filter(b=>b.parcelId===parcelId).length;}
  load(arr){for(const b of [...this.placed])this.removeAt(b.x,b.z);for(const v of arr||[])if(v&&Number.isFinite(v.x)&&Number.isFinite(v.z))this.add(v);}
  dispose(){this.setGhost(null);this.load([]);}
}
