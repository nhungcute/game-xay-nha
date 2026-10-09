import * as THREE from 'three';
export class WaterSystem{
 constructor(scene,field){this.scene=scene;this.field=field;this.group=new THREE.Group();this.group.name='Water';this.scene.add(this.group);
  this.material=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uDeep:{value:new THREE.Color(field.config.palette.water)},uShallow:{value:new THREE.Color('#4ad6d6')},uSun:{value:new THREE.Color('#c4fff3')}},
   vertexShader:`varying vec3 vPos; varying vec2 vUv; uniform float uTime;
    void main(){vUv=uv;vec3 p=position;p.y+=0.11*sin(p.x*.62+uTime*1.25)*cos(p.z*.48+uTime*.86)+.055*sin(p.x*1.7-p.z*.89+uTime*1.2);vPos=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
   fragmentShader:`varying vec3 vPos; varying vec2 vUv; uniform float uTime; uniform vec3 uDeep,uShallow,uSun;
    void main(){float waves=sin(vPos.x*.40+vPos.z*.19+uTime)*sin(vPos.z*.58-vPos.x*.15-uTime*.8);float ripples=sin(vPos.x*1.73+vPos.z*.82+uTime*1.4)*.5+.5;float light=smoothstep(.66,.95,waves*.5+.5)*.35 + pow(ripples,14.)*.16;vec3 col=mix(uDeep,uShallow,.31+.16*waves+.13*vUv.x);col+=uSun*light;gl_FragColor=vec4(col,.93);}`,
   transparent:true,depthWrite:false,side:THREE.DoubleSide
  });
  this.makeSea();this.makeRiver();this.makeLakes();this.makeWaterfall();
 }
 makeSea(){
  const positions=[],uvs=[],idx=[],steps=180,strips=28,waterY=this.field.config.world.waterLevel;
  for(let i=0;i<=steps;i++){
   const x=-this.field.w/2+i*this.field.w/steps,shore=this.field.coastline(x)-1.3;
   for(let j=0;j<=strips;j++){
    let z=shore+(this.field.d/2+9-shore)*j/strips;
    positions.push(x,waterY,z);uvs.push(i/steps,j/strips);
   }
  }
  for(let i=0;i<steps;i++)for(let j=0;j<strips;j++){let a=i*(strips+1)+j,b=a+strips+1;idx.push(a,b,a+1,b,b+1,a+1);}
  this.addGeo(positions,uvs,idx,'Coastal water');
 }
 makeRiver(){
  const cfg=this.field.config.river,curve=new THREE.CatmullRomCurve3(cfg.points.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal',.5);
  const positions=[],uv=[],idx=[],segments=260,across=12,y=this.field.config.world.waterLevel+.04;
  for(let i=0;i<=segments;i++){
   const t=i/segments,p=curve.getPoint(t),v=curve.getTangent(t),nx=-v.z,nz=v.x;
   const w=cfg.width*(.90+.12*Math.sin(t*33)+.13*t);
   for(let k=0;k<=across;k++){
    const side=(k/across-.5)*w;positions.push(p.x+side*nx,y,p.z+side*nz);uv.push(k/across,t);
   }
  }
  for(let i=0;i<segments;i++)for(let k=0;k<across;k++){let a=i*(across+1)+k,b=a+across+1;idx.push(a,b,a+1,b,b+1,a+1);}
  this.addGeo(positions,uv,idx,'Flowing river');
 }
 makeLakes(){for(const lake of this.field.config.lakes){
   const geo=new THREE.CircleGeometry(1,90,0,Math.PI*2);geo.rotateX(-Math.PI/2);geo.scale(lake.rx*1.02,1,lake.rz*1.02);
   const mesh=new THREE.Mesh(geo,this.material);mesh.position.set(lake.x,this.field.config.world.waterLevel+.03,lake.z);mesh.name=lake.id;mesh.frustumCulled=false;this.group.add(mesh);
  }}
 makeWaterfall(){
  const falls=this.field.config.waterfall;
  if(!falls)return;
  // A genuine vertical mesh rather than a 2D image; rotating the camera reveals its depth.
  const positions=[],uvs=[],idx=[],columns=16,rows=24;
  for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
   const t=j/rows,s=i/columns, x=falls.x+(s-.5)*falls.width,
      y=this.field.config.world.waterLevel+(1-t)*falls.height,
      z=falls.z+Math.sin(t*Math.PI)*1.8+.4*Math.sin(s*16+t*19);
   positions.push(x,y,z);uvs.push(s,t);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){let a=j*(columns+1)+i,b=a+columns+1;idx.push(a,b,a+1,b,b+1,a+1);}
  let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(idx);geo.computeVertexNormals();
  const mat=new THREE.MeshStandardMaterial({color:'#e0f9fd',roughness:.16,metalness:.05,transparent:true,opacity:.82,side:THREE.DoubleSide,emissive:'#167ea5',emissiveIntensity:.24});
  const mesh=new THREE.Mesh(geo,mat);mesh.name='3D waterfall';mesh.castShadow=false;this.group.add(mesh);
 }
 addGeo(positions,uvs,indices,name){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();let mesh=new THREE.Mesh(geo,this.material);mesh.name=name;mesh.frustumCulled=false;mesh.renderOrder=1;this.group.add(mesh);}
 update(dt){this.material.uniforms.uTime.value+=dt;}
}
