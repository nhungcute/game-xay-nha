import {inPolygon} from './math.js';
export const TYPES={
 crop:{label:'Crop field',width:5,depth:5,color:'#80a854'},
 barn:{label:'Barn',width:10,depth:8,color:'#bd6650'},
 cottage:{label:'Farm cottage',width:8,depth:7,color:'#ebd5a6'},
 tree:{label:'Fruit tree',width:4,depth:4,color:'#669c51'}
};
export function footprintCorners(x,z,w,d,rot){const c=Math.cos(rot),s=Math.sin(rot),corners=[];for(let dx of [-w/2,w/2])for(let dz of [-d/2,d/2])corners.push([x+dx*c-dz*s,z+dx*s+dz*c]);return corners;}
export function footprintsOverlap(a,b){
 const aa=footprintCorners(a.x,a.z,a.width+.8,a.depth+.8,a.rotation),bb=footprintCorners(b.x,b.z,b.width+.8,b.depth+.8,b.rotation);
 const axes=[];for(const corners of [aa,bb]){const [p,q,r]=corners;axes.push([q[0]-p[0],q[1]-p[1]],[r[0]-p[0],r[1]-p[1]]);}
 for(let [ax,az] of axes){let pa=aa.map(([x,z])=>x*ax+z*az),pb=bb.map(([x,z])=>x*ax+z*az);if(Math.max(...pa)<Math.min(...pb)||Math.max(...pb)<Math.min(...pa))return false;}
 return true;
}
export function validatePlacement({field,vegetation,objects,kind,x,z,rotation=0,ignoreId=null}){
 if(!TYPES[kind]||!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(rotation)||!field.isInside(x,z))return{valid:false,reason:'Outside the world'};
 const d=TYPES[kind],corners=footprintCorners(x,z,d.width,d.depth,rotation),parcel=field.parcelAt(x,z);
 if(!parcel||!corners.every(([px,pz])=>inPolygon(px,pz,parcel.polygon)))return{valid:false,reason:'Entire footprint must fit inside one buildable parcel'};
 for(const [px,pz] of [[x,z],...corners]){
  if(field.isWater(px,pz,1.5))return{valid:false,reason:'Cannot place construction in water'};
  if(field.pathDistance(px,pz)<1.1)return{valid:false,reason:'Clear of dirt paths required'};
 }
 const heights=corners.map(([px,pz])=>field.height(px,pz));
 if(Math.max(...heights)-Math.min(...heights)>3.1)return{valid:false,reason:'Terrain is too steep'};
 if(vegetation?.hasObstacle(x,z,d.width,d.depth))return{valid:false,reason:'Tree or rock collision'};
 const incoming={x,z,width:d.width,depth:d.depth,rotation};
 for(const b of objects){if(b.id!==ignoreId&&footprintsOverlap(incoming,{...b,...TYPES[b.type]}))return{valid:false,reason:'Overlaps an existing construction'};}
 return{valid:true,parcel:parcel.id,reason:'Valid buildable location'};
}
