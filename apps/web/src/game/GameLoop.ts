import { ACESFilmicToneMapping, Color, DirectionalLight, Fog, HemisphereLight, PCFSoftShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
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
import { WorldStore } from './WorldStore';
import { ToolController, useTools } from './ToolController';
import { CameraRig } from './CameraRig';
import { PointerRouter } from './PointerRouter';

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
  private readonly assets:AssetManager;
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.5:2));this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=PCFSoftShadowMap;
    this.scene.background=new Color('#b6d4ce');this.scene.fog=new Fog('#b6d4ce',190,420);
    this.sun.castShadow=true;this.sun.shadow.mapSize.setScalar(mobile?1024:2048);this.sun.shadow.camera.left=-60;this.sun.shadow.camera.right=60;this.sun.shadow.camera.top=60;this.sun.shadow.camera.bottom=-60;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=220;this.sun.shadow.bias=-.0003;
    this.scene.add(this.sun,this.sun.target,new HemisphereLight('#d6edff','#566c37',1.25));
    this.terrain=new TerrainRenderer(this.scene);this.terrain.update(world.state);
    this.water=new WaterRenderer(this.scene);this.water.update(world.state);
    this.overlay=new OverlayRenderer(this.scene);this.overlay.update(world.state);
    this.buildings=new BuildingRenderer(this.scene,assets);this.crops=new CropRenderer(this.scene,assets);this.ghost=new GhostRenderer(this.scene,assets);
    this.renderers=[new RoadRenderer(this.scene),new EmbankRenderer(this.scene),new BridgeRenderer(this.scene),new EnvRenderer(this.scene,assets),this.buildings,this.crops];
    for(const renderer of this.renderers)renderer.update(world.state);
    this.rig=new CameraRig(world.state,(x,z)=>this.terrain.sampleHeight(x,z));this.tools=new ToolController(world);
    this.pointer=new PointerRouter(canvas,this.rig,this.tools,this.terrain.meshes);
    this.subscriptions.push(world.subscribe((state,dirty,entitiesChanged)=>{this.rig.setState(state);if(dirty.length){this.terrain.update(state,dirty);this.overlay.update(state);}if(entitiesChanged)for(const renderer of this.renderers)renderer.update(state);else this.crops.update(state);}),useTools.subscribe(ui=>{const p=ui.preview;const status=p?.valid?(p.warning?'warning':'valid'):'invalid';if(p)this.overlay.preview(p.cells,world.state,status);else this.overlay.hide();if(p&&ui.tool==='build'&&ui.cell)this.ghost.preview(ui.buildingId,ui.cell,ui.rotation,world.state,status);else this.ghost.hide();}));
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();this.frameId=requestAnimationFrame(this.frame);
    if(new URLSearchParams(location.search).get('debug')==='1')this.installDebug();
  }
  private resize():void {const rect=this.canvas.getBoundingClientRect();this.renderer.setSize(rect.width,rect.height,false);this.rig.resize(rect.width,rect.height);}
  private frame=(now:number):void=>{
    const dt=Math.min((now-this.last)/1000,.1);this.last=now;this.pointer.update(dt);this.terrain.animate(dt);this.water.animate(dt);
    this.sun.target.position.copy(this.rig.target);this.sun.position.copy(this.rig.target).add(new Vector3(-50,90,40));
    this.renderer.render(this.scene,this.rig.camera);this.frameCount++;
    if(now-this.second>=1000){this.fps=this.frameCount*1000/(now-this.second);this.second=now;this.frameCount=0;this.world.tick();}
    this.frameId=requestAnimationFrame(this.frame);
  };
  project(x:number,z:number):{x:number;y:number} {const point=new Vector3(x,this.terrain.sampleHeight(x,z),z).project(this.rig.camera),r=this.canvas.getBoundingClientRect();return{x:r.left+(point.x+1)*r.width/2,y:r.top+(1-point.y)*r.height/2};}
  metrics(){const info=this.renderer.info;return{fps:this.fps,drawCalls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length??0,terrain:this.terrain.stats,revision:this.world.state.snapshot.revision};}
  private installDebug():void {
    const debug={getStateHash:()=>stateHash(this.world.state),listSceneObjectTypes:()=>{const types:string[]=[];this.scene.traverse(o=>types.push(o.type));return types;},orbit:(deg:number)=>this.rig.orbit(deg),screenshot:()=>this.canvas.toDataURL('image/png'),metrics:()=>this.metrics(),project:(x:number,z:number)=>this.project(x,z),snapshot:()=>structuredClone(this.world.state.snapshot),flush:()=>this.world.flush()};
    Object.assign(window,{__debug:{...debug,...(import.meta.env.DEV&&new URLSearchParams(location.search).get('test')==='1'?{command:(type:CommandType,payload:unknown)=>this.world.apply(type,payload).result,advance:(ms:number)=>this.world.advanceForTest(ms)}:{})}});
  }
  dispose():void {cancelAnimationFrame(this.frameId);this.resizeObserver.disconnect();for(const unsubscribe of this.subscriptions)unsubscribe();this.pointer.dispose();this.overlay.dispose();this.ghost.dispose();for(const renderer of this.renderers)renderer.dispose();this.terrain.dispose();this.water.dispose();this.assets.dispose();this.renderer.dispose();this.world.dispose();Reflect.deleteProperty(window,'__debug');}
}
