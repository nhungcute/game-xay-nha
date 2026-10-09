import * as THREE from 'three';
import {polygonArea} from '../core/math.js';
export class ParcelsSystem{
 constructor(scene,field){this.scene=scene;this.field=field;this.group=new THREE.Group();this.group.name='Buildable parcel outlines';scene.add(this.group);this.selected=null;this.visible=false;this.overlay=this.buildOverlay();this.group.add(this.overlay);this.overlay.visible=false;}
 buildOverlay(){
  let fillMat=new THREE.MeshBasicMaterial({color:'#e1f5ae',transparent:true,opacity:.20,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3});
  const group=new THREE.Group();group.userData.fillMat=fillMat;
  return group;
 }
 outlinePolygon(parcel,focus){
  const g=new THREE.Group();let poly=parcel.polygon;
  let p3=poly.map(([x,z])=>new THREE.Vector3(x,this.field.height(x,z)+.4,z));
  const center=new THREE.Vector3();p3.forEach(p=>center.add(p));center.multiplyScalar(1/p3.length);center.y=this.field.height(center.x,center.z)+.4;
  const pos=[],idx=[];pos.push(center.x,center.y,center.z);for(let p of p3)pos.push(p.x,p.y,p.z);
  for(let i=0;i<p3.length;i++)idx.push(0,i+1,((i+1)%p3.length)+1);
  let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:'#d3f690',transparent:true,opacity:.25,depthWrite:false,side:THREE.DoubleSide}));g.add(mesh);
  const pts=p3.concat(p3[0]);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:'#dcf8a0',transparent:true,opacity:.95}));g.add(line);
  return g;
 }
 select(parcel){this.selected=parcel;this.overlay.clear();this.overlay.visible=!!parcel;if(parcel)this.overlay.add(this.outlinePolygon(parcel,true));}
 setOutlines(v){this.visible=v;if(!this.outlines){this.outlines=new THREE.Group();this.group.add(this.outlines);for(const p of this.field.config.parcels){let points=p.polygon.map(([x,z])=>new THREE.Vector3(x,this.field.height(x,z)+.22,z));points.push(points[0].clone());this.outlines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#e8eab0',opacity:.45,transparent:true})));}}this.outlines.visible=v;}
 details(parcel){if(!parcel)return null;return{id:parcel.id,name:parcel.name,type:parcel.type,area:Math.round(polygonArea(parcel.polygon))};}
}
