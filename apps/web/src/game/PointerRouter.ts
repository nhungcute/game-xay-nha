import { Raycaster, Vector2 } from 'three';
import type { Mesh } from 'three';
import type { Cell } from '@xay-nha/contracts';
import { CameraRig } from './CameraRig';
import { ToolController, useTools } from './ToolController';

export class PointerRouter {
  private readonly ray=new Raycaster();
  private readonly points=new Map<number,{x:number;y:number}>();
  private origin:{x:number;y:number;button:number}|null=null;
  private dragging=false;
  private readonly abort=new AbortController();
  private readonly keys=new Set<string>();
  constructor(private readonly canvas:HTMLCanvasElement,private readonly rig:CameraRig,private readonly tools:ToolController,private readonly meshes:readonly Mesh[]) {
    const options={signal:this.abort.signal};
    canvas.addEventListener('contextmenu',event=>event.preventDefault(),options);
    canvas.addEventListener('pointerdown',this.down,options);canvas.addEventListener('pointermove',this.move,options);canvas.addEventListener('pointerup',this.up,options);canvas.addEventListener('pointercancel',this.cancel,options);
    canvas.addEventListener('wheel',event=>{event.preventDefault();rig.zoom(event.deltaY);useTools.setState({radial:null});},{...options,passive:false});
    window.addEventListener('keydown',event=>{if((event.target as HTMLElement).matches('input,select,textarea'))return;this.keys.add(event.key.toLowerCase());if(event.key==='Escape')tools.cancel();if(['r','e'].includes(event.key.toLowerCase()))tools.rotate();if(event.key.toLowerCase()==='q')tools.rotate(-1);},options);
    window.addEventListener('keyup',event=>this.keys.delete(event.key.toLowerCase()),options);window.addEventListener('blur',()=>{this.keys.clear();this.points.clear();this.origin=null;},options);
  }
  update(dt:number):void {const x=Number(this.keys.has('d'))-Number(this.keys.has('a')),z=Number(this.keys.has('s'))-Number(this.keys.has('w'));if(x||z)this.rig.pan(x*dt*350,z*dt*350);}
  pick(clientX:number,clientY:number):Cell|null {
    const bounds=this.canvas.getBoundingClientRect();this.ray.setFromCamera(new Vector2((clientX-bounds.left)/bounds.width*2-1,-(clientY-bounds.top)/bounds.height*2+1),this.rig.camera);
    const hit=this.ray.intersectObjects([...this.meshes],false)[0];if(!hit)return null;
    const cell:Cell=[Math.floor(hit.point.x/2),Math.floor(hit.point.z/2)];return cell.every(v=>v>=0&&v<128)?cell:null;
  }
  private down=(event:PointerEvent):void=>{
    this.canvas.setPointerCapture(event.pointerId);this.points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(this.points.size>1){this.tools.cancel();this.origin=null;return;}
    this.origin={x:event.clientX,y:event.clientY,button:event.button};this.dragging=false;
    if(event.button===0){const cell=this.pick(event.clientX,event.clientY);if(cell)this.tools.down(cell);}
  };
  private move=(event:PointerEvent):void=>{
    const old=this.points.get(event.pointerId);
    if(old&&this.points.size===2){
      const other=[...this.points.entries()].find(([id])=>id!==event.pointerId)![1],before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);
      const a=Math.atan2(old.y-other.y,old.x-other.x),b=Math.atan2(event.clientY-other.y,event.clientX-other.x);
      let angle=b-a;if(angle>Math.PI)angle-=2*Math.PI;if(angle< -Math.PI)angle+=2*Math.PI;
      this.rig.orbit(-angle*180/Math.PI);this.rig.zoom((before-after)*3);this.rig.pan(-(event.clientX-old.x)/2,-(event.clientY-old.y)/2);
    } else if(this.origin&&old){
      const dx=event.clientX-old.x,dy=event.clientY-old.y;this.dragging ||= Math.hypot(event.clientX-this.origin.x,event.clientY-this.origin.y)>4;
      if(this.origin.button===2||(this.origin.button===0&&useTools.getState().tool==='explore'&&event.pointerType!=='touch'))this.rig.orbit(-dx*.3,dy*.2);
      else if(this.origin.button===1||(event.pointerType==='touch'&&useTools.getState().tool==='explore'))this.rig.pan(-dx,-dy);
      else {const cell=this.pick(event.clientX,event.clientY);if(cell)this.tools.move(cell,true);}
    } else if(event.pointerType!=='touch'){const cell=this.pick(event.clientX,event.clientY);if(cell&&useTools.getState().tool!=='explore')this.tools.move(cell);}
    if(old)this.points.set(event.pointerId,{x:event.clientX,y:event.clientY});
  };
  private up=(event:PointerEvent):void=>{
    if(this.points.size===1&&this.origin){const cell=this.pick(event.clientX,event.clientY);if(cell&&this.origin.button===0){this.tools.up(cell,event.pointerType==='touch');if(!this.dragging)this.tools.tap(cell);}if(this.origin.button===2&&!this.dragging)this.tools.cancel();}
    this.points.delete(event.pointerId);this.origin=null;if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
  };
  private cancel=():void=>{this.points.clear();this.origin=null;this.tools.cancel();};
  dispose():void {this.abort.abort();this.points.clear();}
}
