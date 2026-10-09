import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { SimState } from '@xay-nha/sim';

export class CameraRig {
  readonly camera=new PerspectiveCamera(40,1,.1,1000);
  readonly target=new Vector3();
  yaw=0;pitch=55;distance=110;
  private state:SimState;
  constructor(state:SimState,private readonly height:(x:number,z:number)=>number){this.state=state;this.reset();}
  reset():void {const c=this.state.template.camera;this.target.fromArray(c.target);this.yaw=c.yawDeg;this.pitch=c.pitchDeg;this.distance=c.distance;this.update();}
  setState(state:SimState):void {this.state=state;}
  focus(x:number,z:number,distance=this.distance,yaw=this.yaw,pitch=this.pitch):void {this.target.set(x,0,z);this.distance=MathUtils.clamp(distance,30,220);this.yaw=yaw;this.pitch=MathUtils.clamp(pitch,35,75);this.update();}
  orbit(dx:number,dy=0):void {this.yaw+=dx;this.pitch=MathUtils.clamp(this.pitch+dy,35,75);this.update();}
  zoom(delta:number):void {this.distance=MathUtils.clamp(this.distance*Math.exp(delta*.001),30,220);this.update();}
  pan(dx:number,dz:number):void {const a=MathUtils.degToRad(this.yaw),scale=this.distance/500;this.target.x+=(dx*Math.cos(a)+dz*Math.sin(a))*scale;this.target.z+=(-dx*Math.sin(a)+dz*Math.cos(a))*scale;this.update();}
  resize(width:number,height:number):void {this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
  update():void {
    const zones=this.state.snapshot.unlockedZones,x=zones.map(z=>z%8),z=zones.map(z=>Math.floor(z/8));
    this.target.x=MathUtils.clamp(this.target.x,Math.max(0,Math.min(...x)-1)*32,Math.min(8,Math.max(...x)+2)*32);
    this.target.z=MathUtils.clamp(this.target.z,Math.max(0,Math.min(...z)-1)*32,Math.min(8,Math.max(...z)+2)*32);
    this.target.y=this.height(this.target.x,this.target.z);
    const yaw=MathUtils.degToRad(this.yaw),pitch=MathUtils.degToRad(this.pitch),horizontal=Math.cos(pitch)*this.distance;
    this.camera.position.set(this.target.x+Math.sin(yaw)*horizontal,this.target.y+Math.sin(pitch)*this.distance,this.target.z+Math.cos(yaw)*horizontal);
    this.camera.position.y=Math.max(this.camera.position.y,this.height(this.camera.position.x,this.camera.position.z)+3);
    this.camera.lookAt(this.target);
  }
}
