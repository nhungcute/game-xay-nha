import * as THREE from 'three';
import {seeded} from '../core/math.js';

export class PathSystem {
  constructor(world,terrain) {
    this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='Independent rural dirt path system';
    const outer=new THREE.MeshStandardMaterial({color:'#9f7d49',roughness:1,side:THREE.DoubleSide});
    const sand=new THREE.MeshStandardMaterial({color:'#d8b87b',roughness:1,side:THREE.DoubleSide});
    const tread=new THREE.MeshStandardMaterial({color:'#baa06a',roughness:1,side:THREE.DoubleSide,transparent:true,opacity:.67});
    for(const p of world.paths){this.addRibbon(p, p.width+.65,.12,outer);this.addRibbon(p,p.width,.15,sand);this.addRibbon(p,p.width*.085,.18,tread,-.25);this.addRibbon(p,p.width*.085,.18,tread,.25);}
    this.addPebbles();
  }
  addRibbon(path,width,elevation,mat,lateral=0) {
    const curve=new THREE.CatmullRomCurve3(path.points.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
    const segments=Math.max(35,path.points.length*18),v=[],idx=[];
    for(let i=0;i<=segments;i++){
      const p=curve.getPoint(i/segments),dir=curve.getTangent(i/segments),norm=new THREE.Vector3(-dir.z,0,dir.x).normalize();
      for(const sign of [-1,1]){
        const x=p.x+norm.x*(sign*width*.5+lateral*path.width),z=p.z+norm.z*(sign*width*.5+lateral*path.width);
        v.push(x,this.terrain.height(x,z)+elevation,z);
      }
      if(i<segments){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();
    const m=new THREE.Mesh(g,mat);m.name=`Dirt track: ${path.id}`;m.receiveShadow=true;this.group.add(m);
  }
  addPebbles(){
    const rand=seeded(this.world.seed+18),stone=new THREE.IcosahedronGeometry(.12,0),mat=new THREE.MeshStandardMaterial({color:'#ab9b7a',roughness:1});
    const placements=[];
    for(const p of this.world.paths){const curve=new THREE.CatmullRomCurve3(p.points.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
      for(let i=0;i<p.points.length*15;i++){
        if(rand()<.38)continue;const t=rand(),v=curve.getPoint(t),dir=curve.getTangent(t),side=rand()>.5?1:-1;
        const x=v.x-dir.z*side*(p.width*.6+rand()*.9),z=v.z+dir.x*side*(p.width*.6+rand()*.9);
        placements.push([x,z,.5+rand()*1.8,rand()*Math.PI*2]);
      }
    }
    const inst=new THREE.InstancedMesh(stone,mat,placements.length);const dummy=new THREE.Object3D();
    placements.forEach(([x,z,s,r],i)=>{dummy.position.set(x,this.terrain.height(x,z)+.12,z);dummy.scale.set(s,s*.46,s*.76);dummy.rotation.y=r;dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);});
    inst.instanceMatrix.needsUpdate=true;inst.castShadow=false;inst.receiveShadow=true;inst.name='Instanced trackside pebbles';this.group.add(inst);
  }
}
