import { ACESFilmicToneMapping, Color, DirectionalLight, Fog, HemisphereLight, PCFSoftShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import type { InstancedMesh, Material, Mesh, PlaneGeometry, Texture } from 'three';
import type { CommandType } from '@xay-nha/contracts';
import { stateHash } from '@xay-nha/sim';
import { AssetManager } from './assets/AssetManager';
import { TerrainRenderer } from './render/TerrainRenderer';
import { WaterRenderer } from './render/WaterRenderer';
import { RoadRenderer } from './render/RoadRenderer';
import { EmbankRenderer } from './render/EmbankRenderer';
import { BridgeRenderer } from './render/BridgeRenderer';
import { OverlayRenderer } from './render/OverlayRenderer';
import { EnvRenderer } from './render/EnvRenderer';
import { BuildingRenderer } from './render/BuildingRenderer';
import { CropRenderer } from './render/CropRenderer';
import { GhostRenderer } from './render/GhostRenderer';
import { CoinRenderer } from './render/CoinRenderer';
import { WorldStore } from './WorldStore';
import { ToolController, useTools } from './ToolController';
import { CameraRig } from './CameraRig';
import { PointerRouter } from './PointerRouter';
import { loadQuality, pixelRatio, saveQuality, type Quality } from './quality';
import { commandSounds, SoundEffects, tickSounds, waterNearby } from './audio';
import { commandEffects, EffectsRenderer, progressEffects } from './render/EffectsRenderer';

export class GameLoop {
  readonly scene=new Scene();
  readonly renderer:WebGLRenderer;
  readonly tools:ToolController;
  readonly rig:CameraRig;
  readonly terrain:TerrainRenderer;
  readonly overlay:OverlayRenderer;
  private readonly water:WaterRenderer;
  private readonly pointer:PointerRouter;
  private readonly buildings:BuildingRenderer;
  private readonly crops:CropRenderer;
  private readonly ghost:GhostRenderer;
  private readonly coins:CoinRenderer;
  private readonly assets:AssetManager;
  private readonly env:EnvRenderer;
  quality:Quality=loadQuality();
  readonly sound=new SoundEffects();
  private readonly effects:EffectsRenderer;
  private readonly renderers:{update: (state:WorldStore['state'])=>void;dispose:()=>void}[];
  private readonly sun=new DirectionalLight('#fff0d5',2.1);
  private readonly subscriptions:(()=>void)[]=[];
  private readonly resizeObserver:ResizeObserver;
  private frameId=0;
  private last=performance.now();
  private second=this.last;
  private frameCount=0;
  fps=0;
  constructor(readonly canvas:HTMLCanvasElement,readonly world:WorldStore,assets:AssetManager){
    this.assets=assets;const mobile=matchMedia('(pointer:coarse)').matches;
    this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=PCFSoftShadowMap;
    this.scene.background=new Color('#b6d4ce');this.scene.fog=new Fog('#b6d4ce',190,420);
    this.sun.castShadow=true;this.sun.shadow.mapSize.setScalar(mobile?1024:2048);this.sun.shadow.camera.left=-60;this.sun.shadow.camera.right=60;this.sun.shadow.camera.top=60;this.sun.shadow.camera.bottom=-60;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=220;this.sun.shadow.bias=-.0003;
    this.scene.add(this.sun,this.sun.target,new HemisphereLight('#d6edff','#566c37',1.25));
    this.terrain=new TerrainRenderer(this.scene);this.terrain.update(world.state);
    this.water=new WaterRenderer(this.scene);this.water.update(world.state);
    this.overlay=new OverlayRenderer(this.scene);this.overlay.update(world.state);
    this.buildings=new BuildingRenderer(this.scene,assets);this.crops=new CropRenderer(this.scene,assets);this.ghost=new GhostRenderer(this.scene,assets);this.coins=new CoinRenderer(this.scene);
    this.renderers=[new RoadRenderer(this.scene),new EmbankRenderer(this.scene),new BridgeRenderer(this.scene),this.env=new EnvRenderer(this.scene,assets),this.buildings,this.crops,this.coins];
    this.applyQuality(this.quality);
    this.effects=new EffectsRenderer(this.scene,canvas.parentElement,()=>this.world.state,()=>[this.rig.target.x,this.rig.target.z]);const project=(x:number,z:number)=>this.project(x,z);
    world.onCommand=(command,accepted,before,after)=>{this.sound.play(commandSounds(command.type,accepted,before,after));if(accepted)this.effects.show(commandEffects(command.type,command.payload,before,after),project);};
    world.onTick=(before,after)=>{this.sound.play(tickSounds(before,after));this.effects.show(progressEffects(before,after),project);};
    for(const renderer of this.renderers)renderer.update(world.state);
    this.rig=new CameraRig(world.state,(x,z)=>this.terrain.sampleHeight(x,z));this.tools=new ToolController(world);
    this.pointer=new PointerRouter(canvas,this.rig,this.tools,this.terrain.meshes);
    this.subscriptions.push(world.subscribe((state,dirty,entitiesChanged)=>{this.rig.setState(state);if(dirty.length){this.terrain.update(state,dirty);this.overlay.update(state);}if(entitiesChanged)for(const renderer of this.renderers)renderer.update(state);else {this.crops.update(state);this.coins.update(state);}}),useTools.subscribe(ui=>{const p=ui.preview;const status=p?.valid?(p.warning?'warning':'valid'):'invalid';if(p)this.overlay.preview(p.cells,world.state,status,p.bad);else this.overlay.hide();if(p&&ui.tool==='build'&&ui.cell)this.ghost.preview(ui.buildingId,ui.cell,ui.rotation,world.state,status);else this.ghost.hide();}));
    canvas.addEventListener('pointerdown',this.unlockAudio);this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();this.frameId=requestAnimationFrame(this.frame);
    if(new URLSearchParams(location.search).get('debug')==='1')this.installDebug();
  }
  /** docs/11 §8 low-graphics mode: shadows off, lower pixel ratio, thinner scenery. Persisted per browser. */
  setQuality(quality:Quality):void {if(quality===this.quality)return;saveQuality(quality);this.applyQuality(quality);this.resize();}
  private applyQuality(quality:Quality):void {
    this.quality=quality;const shadows=quality==='high';
    this.renderer.setPixelRatio(pixelRatio(quality));this.renderer.shadowMap.enabled=shadows;this.sun.castShadow=shadows;
    this.scene.traverse(o=>{const m=(o as Mesh).material;if(m)for(const x of Array.isArray(m)?m:[m])x.needsUpdate=true;});
    this.env.setQuality(quality);
  }
  /** Ambience follows the camera: running water near shores, wind stronger when zoomed out. */
  private updateAmbience():void {const t=this.rig.target,s=this.world.state;this.sound.ambient(waterNearby(s.surface,Math.floor(t.x/2),Math.floor(t.z/2)),Math.max(0,Math.min(1,(260-this.rig.distance)/200)));this.sound.playMusic(s.template.mapKind);}
  private unlockAudio=():void=>this.sound.unlock();
  private resize():void {const rect=this.canvas.getBoundingClientRect();this.renderer.setSize(rect.width,rect.height,false);this.rig.resize(rect.width,rect.height);}
  private frame=(now:number):void=>{
    const dt=Math.min((now-this.last)/1000,.1);this.last=now;this.pointer.update(dt);this.terrain.animate(dt);this.water.animate(dt);this.coins.animate(dt);this.effects.animate(dt);
    this.env.frame(dt,{x:this.rig.target.x,z:this.rig.target.z,yawDeg:this.rig.yaw});
    this.sun.target.position.copy(this.rig.target);this.sun.position.copy(this.rig.target).add(new Vector3(-50,90,40));
    this.renderer.render(this.scene,this.rig.camera);this.frameCount++;
    if(now-this.second>=1000){this.fps=this.frameCount*1000/(now-this.second);this.second=now;this.frameCount=0;this.world.tick();this.updateAmbience();}
    this.frameId=requestAnimationFrame(this.frame);
  };
  project(x:number,z:number):{x:number;y:number} {const point=new Vector3(x,this.terrain.sampleHeight(x,z),z).project(this.rig.camera),r=this.canvas.getBoundingClientRect();return{x:r.left+(point.x+1)*r.width/2,y:r.top+(1-point.y)*r.height/2};}
  metrics(){const info=this.renderer.info;return{quality:this.quality,muted:this.sound.muted,musicOn:this.sound.musicOn,pending:this.world.pendingCount(),clockSkewMs:this.world.clockSkewMs(),fps:this.fps,drawCalls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length??0,terrain:this.terrain.stats,revision:this.world.state.snapshot.revision};}
  private installDebug():void {
    const debug={getStateHash:()=>stateHash(this.world.state),listSceneObjectTypes:()=>{const types:string[]=[];this.scene.traverse(o=>types.push(o.type));return types;},auditScene:()=>this.auditScene(),envCull:(enabled:boolean)=>this.env.setFrustumCulled(enabled),envBatches:()=>{const batches:{name:string;count:number;capacity:number;visible:boolean;castShadow:boolean;boundingSphereR:number}[]=[];this.env.sceneBatches(b=>batches.push(b));return batches;},env:()=>{const s=this.world.state,removed=new Set(s.snapshot.delta.removedEnvIds);return s.env.filter(e=>!removed.has(e.id)&&s.snapshot.unlockedZones.includes(Math.floor(e.cell[1]/16)*8+Math.floor(e.cell[0]/16))).map(e=>({id:e.id,cell:e.cell,assetId:e.assetId,blocking:e.blocking,footprint:e.footprint}));},orbit:(deg:number)=>this.rig.orbit(deg),camera:(x:number,z:number,distance?:number,yaw?:number,pitch?:number)=>this.rig.focus(x,z,distance,yaw,pitch),cameraState:()=>({distance:this.rig.distance,yaw:this.rig.yaw,pitch:this.rig.pitch,target:this.rig.target.toArray()}),screenshot:()=>this.canvas.toDataURL('image/png'),metrics:()=>this.metrics(),project:(x:number,z:number)=>this.project(x,z),snapshot:()=>structuredClone(this.world.state.snapshot),flush:()=>this.world.flushSaves(),drain:()=>this.world.drain()};
    Object.assign(window,{__debug:{...debug,...(import.meta.env.DEV&&new URLSearchParams(location.search).get('test')==='1'?{command:(type:CommandType,payload:unknown)=>this.world.apply(type,payload).result,advance:(ms:number)=>this.world.advanceForTest(ms),loadSnapshot:(snapshot:unknown)=>this.world.loadSnapshot(snapshot)}:{})}});
  }
  /** docs/10 §5: detect flat image planes faking 3D (textured planes / sprites) and summarise the scene. */
  auditScene():{objects:number;meshes:number;instanced:number;sprites:number;texturedPlanes:number;largestPlaneM:number;textures:number}{
    let objects=0,meshes=0,instanced=0,sprites=0,texturedPlanes=0,largestPlaneM=0;const textures=new Set<string>();
    this.scene.traverse(o=>{objects++;if(o.type==='Sprite')sprites++;
      const mesh=o as Mesh;if(!mesh.isMesh)return;meshes++;if((o as InstancedMesh).isInstancedMesh)instanced++;
      const mats=(Array.isArray(mesh.material)?mesh.material:[mesh.material]) as (Material&{map?:Texture|null})[];
      for(const m of mats)if(m.map)textures.add(m.map.uuid);
      if(mesh.geometry.type==='PlaneGeometry'){const p=mesh.geometry as PlaneGeometry;largestPlaneM=Math.max(largestPlaneM,p.parameters.width,p.parameters.height);if(mats.some(m=>m.map))texturedPlanes++;}
    });
    return {objects,meshes,instanced,sprites,texturedPlanes,largestPlaneM,textures:textures.size};
  }
  dispose():void {cancelAnimationFrame(this.frameId);this.resizeObserver.disconnect();for(const unsubscribe of this.subscriptions)unsubscribe();this.canvas.removeEventListener('pointerdown',this.unlockAudio);this.pointer.dispose();this.overlay.dispose();this.ghost.dispose();for(const renderer of this.renderers)renderer.dispose();this.terrain.dispose();this.water.dispose();this.assets.dispose();this.renderer.dispose();this.world.onCommand=undefined;this.world.onTick=undefined;this.sound.dispose();this.effects.dispose();this.world.dispose();Reflect.deleteProperty(window,'__debug');}
}
