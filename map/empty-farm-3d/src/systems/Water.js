import * as THREE from 'three';
import {seeded} from '../core/math.js';

export class WaterSystem {
  constructor(world,terrain) {
    this.world=world;this.terrain=terrain;this.group=new THREE.Group();this.group.name='Real geometric rivers, lakes and waterfalls';
    this.uniforms={uTime:{value:0}};
    this.waterMaterial=new THREE.ShaderMaterial({
      uniforms:this.uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`varying vec2 vUv;varying vec3 vWorld;uniform float uTime;
        void main(){vUv=uv;vec3 p=position;p.y+=0.045*sin(p.x*.69+p.z*.31+uTime*.85)*cos(p.z*.4-uTime*.6);vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader:`varying vec2 vUv;varying vec3 vWorld;uniform float uTime;
        float wave(vec2 p){return sin(p.x*.5+sin(p.y*.32+uTime*.45)*1.5+uTime*.58)*cos(p.y*.53-uTime*.35);}
        void main(){float w=wave(vWorld.xz);float lines=pow(max(0.,sin(vWorld.x*.9+vWorld.z*.42-uTime*.95)),22.);float sparkle=pow(max(0.,sin(vWorld.x*2.0+uTime)*sin(vWorld.z*2.3-uTime*.9)),28.);
        vec3 shallow=vec3(.15,.69,.78);vec3 deep=vec3(.04,.35,.55);float t=.4+.20*w+.20*sin(vWorld.z*.13+vWorld.x*.08);vec3 col=mix(deep,shallow,clamp(t,0.,1.));col+=vec3(.43,.60,.56)*(lines*.21+sparkle*.18);gl_FragColor=vec4(col,.94);}`
    });
    this.foamMat=new THREE.MeshBasicMaterial({color:0xd4faf5,transparent:true,opacity:.71,depthWrite:false,side:THREE.DoubleSide});
    this.foamPlaneMatrices=[];this.foamArcMatrices=[];
    this.buildRivers();this.buildLakes();this.buildFoamInstances();this.buildWaterfalls();
  }
  buildRivers() {
    const rng=seeded(this.world.seed+201);
    for(const river of this.world.rivers){
      const curve=new THREE.CatmullRomCurve3(river.points.map(([x,z])=>new THREE.Vector3(x,river.level,z)),false,'catmullrom',.4);
      const parts=Math.max(100,river.points.length*15);const verts=[],uv=[],ids=[];
      for(let i=0;i<=parts;i++) {
        const t=i/parts,p=curve.getPoint(t),d=curve.getTangent(t),n=new THREE.Vector3(-d.z,0,d.x).normalize();
        const width=river.width*(.90+.11*Math.sin(t*17)+.06*Math.sin(t*45));
        for(const sign of [-1,1]){
          const o=p.clone().addScaledVector(n,sign*width);
          verts.push(o.x,river.level+.04,o.z);uv.push(t,sign*.5+.5);
        }
        if(i<parts){const a=i*2;ids.push(a,a+2,a+1,a+1,a+2,a+3);}
        if(i>2 && i<parts-2 && i%3===0 && rng()>.17){
          const bank=p.clone().addScaledVector(n,(rng()>.5?1:-1)*(width+.1));
          const foam=new THREE.Object3D();
          foam.rotation.x=-Math.PI/2;foam.rotation.z=Math.atan2(d.x,d.z);
          foam.position.set(bank.x,river.level+.15,bank.z);
          foam.scale.set(.5+rng()*1.7,.11+rng()*.19,1);
          foam.updateMatrix();this.foamPlaneMatrices.push(foam.matrix.clone());
        }
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ids);geo.computeVertexNormals();
      const mesh=new THREE.Mesh(geo,this.waterMaterial);mesh.name=`River geometry: ${river.id}`;this.group.add(mesh);
    }
  }
  buildLakes() {
    const rng=seeded(this.world.seed+55);
    for(const l of this.world.lakes) {
      const verts=[],uv=[],indices=[];const rings=6,segs=100;
      for(let r=0;r<=rings;r++)for(let i=0;i<=segs;i++) {
        const a=i/segs*Math.PI*2,rr=r/rings,irreg=1+.035*Math.sin(a*7+l.x)+.028*Math.cos(a*11+l.z);
        const x=l.x+Math.cos(a)*l.rx*rr*irreg,z=l.z+Math.sin(a)*l.rz*rr*irreg;
        verts.push(x,l.level+.045,z);uv.push(x*.03,z*.03);
      }
      for(let r=0;r<rings;r++)for(let i=0;i<segs;i++) {
        const a=r*(segs+1)+i,b=a+segs+1;indices.push(a,b,a+1,a+1,b,b+1);
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
      const mesh=new THREE.Mesh(g,this.waterMaterial);mesh.name=`Lake/pond geometry: ${l.id}`;this.group.add(mesh);
      for(let i=0;i<54;i++){
        const ang=rng()*Math.PI*2,d=0.81+rng()*.17,x=l.x+Math.cos(ang)*l.rx*d,z=l.z+Math.sin(ang)*l.rz*d;
        const wave=new THREE.Object3D();const size=.23+rng()*.48;
        wave.rotation.x=-Math.PI/2;wave.rotation.z=ang;wave.position.set(x,l.level+.16,z);
        wave.scale.set(size,size,1);wave.updateMatrix();this.foamArcMatrices.push(wave.matrix.clone());
      }
    }
  }
  buildFoamInstances() {
    for(const [name,geo,matrices] of [
      ['Shoreline foam patches',new THREE.PlaneGeometry(1,1),this.foamPlaneMatrices],
      ['Instanced water ripples',new THREE.TorusGeometry(1,.036,3,16,Math.PI*.92),this.foamArcMatrices]
    ]){
      if(!matrices.length)continue;
      const inst=new THREE.InstancedMesh(geo,this.foamMat,matrices.length);inst.name=name;
      matrices.forEach((m,i)=>inst.setMatrixAt(i,m));inst.instanceMatrix.needsUpdate=true;
      inst.renderOrder=3;inst.frustumCulled=false;this.group.add(inst);
    }
  }
  buildWaterfalls() {
    for(const w of this.world.waterfalls) {
      const rockMat=new THREE.MeshStandardMaterial({color:'#7d8176',roughness:1,flatShading:true});
      for(let i=0;i<9;i++){
        const a=i/8*Math.PI*2,rock=new THREE.Mesh(new THREE.IcosahedronGeometry(1.5,1),rockMat);
        const xx=w.x+Math.sin(a)*w.width*.67,zz=w.z-2+Math.cos(a)*1.6;
        rock.scale.set(.9+(i%3)*.45,2.1+(i%4)*.55,1.5);
        rock.position.set(xx,3.0+(i%3)*.68,zz);rock.castShadow=true;rock.receiveShadow=true;this.group.add(rock);
      }
      const y=8.4,base=.91,geo=new THREE.PlaneGeometry(w.width,y-base,28,24),pos=geo.attributes.position;
      for(let i=0;i<pos.count;i++){const x=pos.getX(i),localY=pos.getY(i);pos.setZ(i,Math.sin(x*2.3+localY*1.6)*.24+(1-localY/(y-base))*.65);}
      geo.computeVertexNormals();
      const fallMat=new THREE.MeshBasicMaterial({color:'#75dcf0',transparent:true,opacity:.83,side:THREE.DoubleSide,depthWrite:false});
      const m=new THREE.Mesh(geo,fallMat);m.position.set(w.x,(y+base)/2,w.z);m.name='3D waterfall curtain';this.group.add(m);
      for(let i=0;i<18;i++){
        const x=w.x+(i/17-.5)*w.width;const curtain=new THREE.Mesh(new THREE.BoxGeometry(.10,y-base,.045),new THREE.MeshBasicMaterial({color:'#d8ffff',transparent:true,opacity:.28+(i%5)*.044}));
        curtain.position.set(x,(y+base)/2,w.z+.16);this.group.add(curtain);
      }
      const foam=new THREE.Mesh(new THREE.SphereGeometry(w.width*.75,18,8),new THREE.MeshBasicMaterial({color:'#c1faf9',transparent:true,opacity:.6}));foam.scale.y=.12;foam.position.set(w.x,base,w.z+.7);this.group.add(foam);
    }
  }
  update(time){this.uniforms.uTime.value=time;}
}
