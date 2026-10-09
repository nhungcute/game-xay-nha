import * as THREE from 'three';
import {noise,clamp,smoothstep} from '../core/math.js';
export class TerrainSystem{
 constructor(scene,field){this.scene=scene;this.field=field;this.config=field.config;this.chunks=new Map();this.active=new Set();this.pickables=[];this.size=this.config.world.chunkSize;this.nx=Math.ceil(field.w/this.size);this.nz=Math.ceil(field.d/this.size);this.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,flatShading:false});}
 key(ix,iz){return `${ix}:${iz}`;}
 create(ix,iz){
  const size=this.size,seg=30,x0=-this.field.w/2+ix*size,z0=-this.field.d/2+iz*size;
  const geom=new THREE.PlaneGeometry(size,size,seg,seg);geom.rotateX(-Math.PI/2);
  const pos=geom.attributes.position,colors=new Float32Array(pos.count*3);
  const base=new THREE.Color(this.config.palette.grass),meadow=new THREE.Color(this.config.palette.meadow),sand=new THREE.Color(this.config.palette.sand),dirt=new THREE.Color(this.config.palette.dirt);
  const temp=new THREE.Color();
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i)+x0+size/2,z=pos.getZ(i)+z0+size/2;
   const y=this.field.height(x,z);pos.setY(i,y);
   const waterD=this.field.waterDistance(x,z),pathD=this.field.pathDistance(x,z);
   const n=noise(x*.12,z*.12,this.config.seed+94),m=noise(x*.047,z*.047,this.config.seed+202);
   temp.copy(base).lerp(meadow,clamp(.45+m*.5+n*.2,0,1));
   if(this.field.parcelAt(x,z))temp.lerp(meadow,.22);
   temp.lerp(sand,1-smoothstep(.7,8,waterD));
   temp.lerp(dirt,1-smoothstep(-.3,1.7,pathD));
   const light=clamp(.98+n*.045+m*.035,.89,1.08);temp.multiplyScalar(light);
   colors[3*i]=temp.r;colors[3*i+1]=temp.g;colors[3*i+2]=temp.b;
  }
  pos.needsUpdate=true;geom.setAttribute('color',new THREE.BufferAttribute(colors,3));geom.computeVertexNormals();geom.computeBoundingSphere();
  let mesh=new THREE.Mesh(geom,this.material);mesh.name=`terrain-${ix}-${iz}`;mesh.userData.terrain=true;mesh.position.set(x0+size/2,0,z0+size/2);mesh.receiveShadow=true;
  return mesh;
 }
 update(target,radius=220){
  const desired=new Set();
  for(let ix=0;ix<this.nx;ix++)for(let iz=0;iz<this.nz;iz++){
   let cx=-this.field.w/2+(ix+.5)*this.size,cz=-this.field.d/2+(iz+.5)*this.size;
   if(Math.hypot(cx-target.x,cz-target.z)>radius+this.size*.9)continue;
   let key=this.key(ix,iz);desired.add(key);
   if(!this.chunks.has(key))this.chunks.set(key,this.create(ix,iz));
   if(!this.active.has(key))this.scene.add(this.chunks.get(key));
  }
  for(let key of this.active)if(!desired.has(key))this.scene.remove(this.chunks.get(key));
  this.active=desired;this.pickables=[...desired].map(k=>this.chunks.get(k));
  return desired;
 }
 getPickables(){return this.pickables;}
 dispose(){for(const mesh of this.chunks.values())mesh.geometry.dispose();this.material.dispose();}
}
