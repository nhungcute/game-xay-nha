import * as THREE from 'three';
import {TYPES,validatePlacement} from '../core/placement.js';
export {TYPES} from '../core/placement.js';
export class ConstructionSystem{
 constructor(scene,field,vegetation){this.scene=scene;this.field=field;this.vegetation=vegetation;this.group=new THREE.Group();this.group.name='Player placed constructions';this.scene.add(this.group);this.objects=[];this.preview=null;this.mode=null;this.rotation=0;this.valid=false;this.hover=null;}
 configure(type){if(type!==null&&!TYPES[type])throw new Error('Invalid construction type');this.mode=type;this.clearPreview();if(type){this.preview=this.makeModel(type,true);this.scene.add(this.preview);this.preview.visible=false;}}
 rotate(){this.rotation=(this.rotation+Math.PI/2)%(2*Math.PI);if(this.hover)this.updateHover(this.hover.x,this.hover.z);}
 makeModel(type,preview=false){
  const def=TYPES[type],root=new THREE.Group(),standard=(hex)=>new THREE.MeshStandardMaterial({color:hex,roughness:1,transparent:preview,opacity:preview?.56:1,depthWrite:!preview});
  const addBox=(w,h,d,x,y,z,color)=>{let m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),standard(color));m.position.set(x,y,z);m.castShadow=!preview;m.receiveShadow=true;root.add(m);};
  if(type==='crop'){
   addBox(4.8,.18,4.8,0,.11,0,'#755333');
   for(let x=-1.65;x<=1.66;x+=1.1)for(let z=-1.65;z<=1.66;z+=1.1){let plant=new THREE.Mesh(new THREE.ConeGeometry(.29,.85,5),standard('#6d9f43'));plant.position.set(x,.59,z);root.add(plant);}
  }else if(type==='barn'||type==='cottage'){
   const w=def.width,h=type==='barn'?6.1:4.5,d=def.depth;
   addBox(w,h,d,0,h/2,0,type==='barn'?'#ba5944':'#e3ca9e');
   for(let side of [-1,1]){
    let roof=new THREE.Mesh(new THREE.BoxGeometry(w*.62,.3,d+.8),standard(type==='barn'?'#5a604c':'#ac7655'));
    roof.rotation.z=side*.47;roof.position.set(side*w*.245,h+w*.125,0);roof.castShadow=!preview;root.add(roof);
   }
   addBox(w*.23,h*.58,.14,0,h*.29,d/2+.07,type==='barn'?'#634b3a':'#8b6545');
   if(type==='cottage')addBox(1.3,1.5,.14,-w*.31,h*.53,d/2+.08,'#8fd1d7');
  }else if(type==='tree'){
   let trunk=new THREE.Mesh(new THREE.CylinderGeometry(.36,.48,2.9,8),standard('#785a3b'));trunk.position.y=1.45;root.add(trunk);
   for(const [x,y,z,r] of [[0,4,0,2],[-.8,3.55,0,1.1],[.9,3.7,.3,1.2]]){
    const orb=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),standard('#679d46'));orb.position.set(x,y,z);root.add(orb);
   }
  }
  root.userData.type=type;return root;
 }
 validate(x,z,type=this.mode,rot=this.rotation,ignoringId=null){
  return validatePlacement({field:this.field,vegetation:this.vegetation,objects:this.objects,kind:type,x,z,rotation:rot,ignoreId:ignoringId});
 }
 updateHover(x,z){
  this.hover={x,z};if(!this.mode||!this.preview)return;
  const res=this.validate(x,z);this.valid=res.valid;
  this.preview.visible=true;this.preview.position.set(x,this.field.height(x,z)+.13,z);this.preview.rotation.y=this.rotation;
  this.preview.traverse(o=>{if(o.isMesh){o.material.color.set(this.valid?'#a9f3b7':'#fa7f77');o.material.opacity=this.valid?.54:.45;}});
  return res;
 }
 clearPreview(){if(this.preview){this.scene.remove(this.preview);this.preview.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});this.preview=null;}this.hover=null;}
 place(x,z){if(!this.mode)return{valid:false,reason:'Select a tool'};let result=this.validate(x,z);if(!result.valid)return result;
  const b={id:`B-${Date.now().toString(36)}-${this.objects.length.toString(36)}`,type:this.mode,parcelId:result.parcel,x:Number(x.toFixed(3)),z:Number(z.toFixed(3)),rotation:this.rotation};
  this.add(b);return{...result,object:b};
 }
 add(obj){
  const mesh=this.makeModel(obj.type,false);mesh.position.set(obj.x,this.field.height(obj.x,obj.z)+.12,obj.z);mesh.rotation.y=obj.rotation;mesh.userData.id=obj.id;this.group.add(mesh);this.objects.push({...obj});return mesh;
 }
 clear(){this.group.clear();this.objects=[];}
 save(){return{schemaVersion:1,worldId:this.field.config.id,seed:this.field.config.seed,buildings:this.objects.map(o=>({...o}))};}
 restore(state){
  if(!state||state.schemaVersion!==1||state.worldId!==this.field.config.id||state.seed!==this.field.config.seed||!Array.isArray(state.buildings)||state.buildings.length>2000)throw new Error('Invalid map save: version or world mismatch');
  const accepted=[];
  this.clear();for(const b of state.buildings){
   if(!b||typeof b.id!=='string'||!TYPES[b.type]||![b.x,b.z,b.rotation].every(Number.isFinite)){this.clear();throw new Error('Invalid construction entry');}
   const test=this.validate(b.x,b.z,b.type,b.rotation);if(!test.valid){this.clear();throw new Error('Saved object fails collision check: '+test.reason);}
   this.add(b);accepted.push(b);
  }
  return accepted.length;
 }
}
