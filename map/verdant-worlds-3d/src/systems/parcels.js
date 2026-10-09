import * as THREE from 'three';
import {polygonCenter} from '../core/math.js';
export class ParcelSystem {
  constructor(world,terrain){
    this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='BUILDABLE_PARCELS';this.selected=null;
    this.highlight=new THREE.Group();this.group.add(this.highlight);
    this.labels=new Map();
    const mat=new THREE.MeshBasicMaterial({color:'#dafa8b',side:THREE.DoubleSide,transparent:true,opacity:.2,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
    this.fillMat=mat;
  }
  select(parcel){
    while(this.highlight.children.length){const o=this.highlight.children[0];this.highlight.remove(o);o.geometry?.dispose();if(o.material!==this.fillMat)o.material?.dispose();}
    this.selected=parcel;
    if(!parcel)return;
    const vertices=[],colors=[],idx=[],c=polygonCenter(parcel.points),height=this.terrain.height(...c);
    const n=parcel.points.length;
    for(const [x,z] of parcel.points)vertices.push(x,this.terrain.height(x,z)+.31,z);
    vertices.push(c[0],height+.34,c[1]);
    for(let i=0;i<n;i++)idx.push(i,(i+1)%n,n);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(idx);
    const face=new THREE.Mesh(g,this.fillMat);face.renderOrder=5;this.highlight.add(face);
    const linePts=parcel.points.map(([x,z])=>new THREE.Vector3(x,this.terrain.height(x,z)+.37,z));
    const loop=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(linePts),new THREE.LineBasicMaterial({color:'#e9ff9b',depthTest:true}));this.highlight.add(loop);
  }
  dispose(){this.select(null);this.fillMat.dispose();}
}
