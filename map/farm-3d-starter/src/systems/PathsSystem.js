import * as THREE from 'three';
export class PathsSystem{
 constructor(scene,field){this.field=field;this.group=new THREE.Group();this.group.name='Natural dirt paths';scene.add(this.group);
  this.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
  for(const def of field.config.paths)this.build(def);
 }
 build(def){
  let spline=new THREE.CatmullRomCurve3(def.points.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
  const seg=Math.max(16,Math.ceil(spline.getLength()/1.15));let positions=[],colors=[],index=[];
  const cEdge=new THREE.Color('#b59a6d'),cMid=new THREE.Color(this.field.config.palette.dirt);
  for(let i=0;i<=seg;i++){
   const p=spline.getPoint(i/seg),t=spline.getTangent(i/seg),nx=-t.z,nz=t.x;
   for(let k=0;k<5;k++){
    const u=k/4,side=(u-.5)*def.width;
    let x=p.x+side*nx,z=p.z+side*nz;
    const h=this.field.height(x,z)+.13;
    positions.push(x,h,z);
    const c=cEdge.clone().lerp(cMid,(1-Math.abs(u-.5)*2)*.9);
    c.multiplyScalar(.96+.04*Math.sin(i*.41+k*3.7));colors.push(c.r,c.g,c.b);
   }
  }
  for(let i=0;i<seg;i++)for(let k=0;k<4;k++){let a=i*5+k,b=a+5;index.push(a,b,a+1,b,b+1,a+1);}
  let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(index);g.computeVertexNormals();
  let mesh=new THREE.Mesh(g,this.material);mesh.name=`Dirt path ${def.id}`;mesh.receiveShadow=true;this.group.add(mesh);
 }
}
