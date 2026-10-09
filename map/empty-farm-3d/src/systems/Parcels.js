import * as THREE from 'three';
import {centroid,seeded,polyContains,polygonEdgeDistance} from '../core/math.js';

export class ParcelSystem {
  constructor(world,terrain) {
    this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='Farm-ready editable parcels';this.meshes=[];
    this.selected=null;this.outlines=[];this.fenceGroup=new THREE.Group();this.fenceGroup.name='Optional wooden fence segments';this.group.add(this.fenceGroup);
    const rand=seeded(world.seed+100);this.fencePostMatrices=[];this.fenceRailMatrices=[];
    for(const p of world.parcels){this.addParcel(p,rand);}
    this.finalizeFences();
  }
  addParcel(parcel,rand) {
    const pts=parcel.points,center=centroid(pts),positions=[],uv=[],ids=[];
    // Curved, tessellated ground patch follows underlying terrain height (no 2D facade
    // and no clipping into elevations, unlike a single flat polygon).
    for(let edge=0;edge<pts.length;edge++){
      const a=pts[edge],b=pts[(edge+1)%pts.length];
      const steps=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/1.5),rings=11;
      const start=positions.length/3;
      for(let r=0;r<=rings;r++)for(let i=0;i<=steps;i++){
        const t=i/steps,q=r/rings,xx=a[0]+(b[0]-a[0])*t,zz=a[1]+(b[1]-a[1])*t;
        const x=center[0]+(xx-center[0])*q,z=center[1]+(zz-center[1])*q;
        positions.push(x,this.terrain.height(x,z)+.22,z);uv.push(x*.08,z*.08);
      }
      for(let r=0;r<rings;r++)for(let i=0;i<steps;i++){
        const a0=start+r*(steps+1)+i,b0=a0+steps+1;
        ids.push(a0,a0+1,b0,a0+1,b0+1,b0);
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ids);geo.computeVertexNormals();
    const soil=parcel.kind==='soil';
    const mat=new THREE.MeshStandardMaterial({color:soil?'#ae8459':'#98cd63',roughness:1,metalness:0,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geo,mat);mesh.name=`Buildable parcel ${parcel.id}`;mesh.userData.parcelId=parcel.id;mesh.receiveShadow=true;this.meshes.push(mesh);this.group.add(mesh);
    // Real, slightly inset 3D border. Border can be hidden in the viewer.
    const points=[];
    for(let i=0;i<pts.length;i++) {
      const a=pts[i],b=pts[(i+1)%pts.length];const n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/.72);
      for(let j=0;j<n;j++){const t=j/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        points.push(new THREE.Vector3(x,this.terrain.height(x,z)+.28,z));}
    }
    const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:soil?'#805c36':'#e3e7a7',transparent:true,opacity:.63}));
    line.name=`Parcel boundary ${parcel.id}`;line.userData.border=true;this.outlines.push(line);this.group.add(line);
    if(soil) this.addSoilRows(parcel,rand);
    // Some naturally scattered fence fragments, never enclosing every field.
    if(['FARM-001','FARM-002','FARM-004','FARM-006','FARM-009','FARM-013'].includes(parcel.id))this.addFenceFragments(parcel,rand);
  }
  addSoilRows(parcel,rand){
    const pts=parcel.points;const box=pts.reduce((b,[x,z])=>[Math.min(b[0],x),Math.max(b[1],x),Math.min(b[2],z),Math.max(b[3],z)],[Infinity,-Infinity,Infinity,-Infinity]);
    const material=new THREE.MeshStandardMaterial({color:'#946841',roughness:1,transparent:true,opacity:.8,side:THREE.DoubleSide});
    for(let z=box[2]+2;z<box[3]-2;z+=2.15){
      const vertices=[];
      for(let x=box[0]+1;x<box[1]-1;x+=.65){
        if(polyContains(x,z,pts) && polygonEdgeDistance(x,z,pts)>2.0){
          const y=this.terrain.height(x,z)+.29;
          vertices.push(x,y,z,x,y,z+.36);
        } else if(vertices.length>=4){this.rowMesh(vertices,material);vertices.length=0;}
      }
      if(vertices.length>=4)this.rowMesh(vertices,material);
    }
  }
  rowMesh(verts,mat){
    const vertices=[],idx=[];
    for(let i=0;i<verts.length;i+=6){vertices.push(...verts.slice(i,i+6));if(i>0){const k=(i/6-1)*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}}
    if(!idx.length)return;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(idx);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat);mesh.name='Prepared soil furrows (no crops)';this.group.add(mesh);
  }
  addFenceFragments(parcel,rand){
    const pts=parcel.points;
    const dummy=new THREE.Object3D();
    for(let edge=0;edge<pts.length;edge++){
      if(edge%2===0)continue;
      const a=pts[edge],b=pts[(edge+1)%pts.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]),posts=Math.floor(length/3.3);
      if(posts<3)continue;
      for(let i=0;i<=posts;i++){
        const t=i/posts;if(t>.38 && t<.53)continue;// gap for entry
        const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,y=this.terrain.height(x,z);
        dummy.position.set(x,y+.76,z);dummy.rotation.set(0,0,0);dummy.scale.set(.27,1.45,.27);dummy.updateMatrix();this.fencePostMatrices.push(dummy.matrix.clone());
        if(i===posts||((i+1)/posts>.38&&(i+1)/posts<.53))continue;
        const nx=a[0]+(b[0]-a[0])*(i+1)/posts,nz=a[1]+(b[1]-a[1])*(i+1)/posts;
        const midX=(x+nx)/2,midZ=(z+nz)/2,d=Math.hypot(nx-x,nz-z),angle=-Math.atan2(nz-z,nx-x);
        for(const yy of [.65,1.12]){
          dummy.position.set(midX,(y+this.terrain.height(nx,nz))/2+yy,midZ);dummy.rotation.y=angle;dummy.scale.set(d+.08,.13,.16);dummy.updateMatrix();this.fenceRailMatrices.push(dummy.matrix.clone());
        }
      }
    }
  }
  finalizeFences(){
    for(const [name,matrices,color] of [
      ['Instanced wooden fence posts',this.fencePostMatrices,'#80623c'],
      ['Instanced wooden fence rails',this.fenceRailMatrices,'#b48a57']
    ]){
      if(!matrices.length)continue;
      const inst=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color,roughness:1}),matrices.length);
      inst.name=name;inst.castShadow=true;inst.receiveShadow=true;
      matrices.forEach((m,i)=>inst.setMatrixAt(i,m));inst.instanceMatrix.needsUpdate=true;
      this.fenceGroup.add(inst);
    }
  }
  select(id){
    this.selected=id;
    this.meshes.forEach(m=>{
      const sel=m.userData.parcelId===id;
      m.material.emissive.setHex(sel?0x345323:0x000000);m.material.emissiveIntensity=sel?.23:0;
    });
    this.outlines.forEach(l=>{const yes=l.name.endsWith(id);l.material.color.set(yes?'#ffffbb':'#d8df9f');l.material.opacity=yes?1:.45;});
  }
  setBordersVisible(v){this.outlines.forEach(m=>m.visible=v);this.fenceGroup.visible=v;}
}
