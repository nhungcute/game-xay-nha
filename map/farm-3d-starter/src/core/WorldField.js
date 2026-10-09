import {clamp,interpolateX,noise,polylineDistance,smoothstep,inPolygon,polygonEdgeDistance} from './math.js';
export class WorldField{
 constructor(config){this.config=config;this.seed=config.seed;this.w=config.world.width;this.d=config.world.depth;this.riverPoints=config.river.points;this.pathLines=config.paths.map(p=>({width:p.width,points:p.points}));}
 coastline(x){return interpolateX(this.config.coastline,x);}
 riverDistance(x,z){return polylineDistance(x,z,this.riverPoints);}
 lakeDistance(x,z){let dist=Infinity;for(let l of this.config.lakes){let dx=(x-l.x)/l.rx,dz=(z-l.z)/l.rz;dist=Math.min(dist,(Math.hypot(dx,dz)-1)*Math.min(l.rx,l.rz));}return dist;}
 coastDistance(x,z){return this.coastline(x)-z;}
 waterDistance(x,z){return Math.min(this.coastDistance(x,z),this.riverDistance(x,z)-this.config.river.width*.5,this.lakeDistance(x,z));}
 isWater(x,z,buffer=0){return this.waterDistance(x,z)<buffer;}
 isInside(x,z){return x>=-this.w/2&&x<=this.w/2&&z>=-this.d/2&&z<=this.d/2;}
 pathDistance(x,z){let d=Infinity;for(const p of this.pathLines){d=Math.min(d,polylineDistance(x,z,p.points)-p.width/2);}return d;}
 parcelAt(x,z){return this.config.parcels.find(p=>inPolygon(x,z,p.polygon))||null;}
 parcelProximity(x,z){let min=Infinity;for(const p of this.config.parcels){if(inPolygon(x,z,p.polygon))return 0;min=Math.min(min,polygonEdgeDistance(x,z,p.polygon));}return min;}
 height(x,z){
  const settings=this.config.world;
  const n1=noise(x*.024,z*.024,this.seed),n2=noise(x*.076,z*.076,this.seed+19),n3=noise(x*.18,z*.18,this.seed+37);
  const hills=1-smoothstep(-115,-52,z);
  let ground=settings.baseHeight+n1*settings.heightVariation+n2*.64+n3*.14;
  ground+=Math.max(0,hills)* (4+2.3*noise(x*.036,z*.036,this.seed+92));
  const lakeDist=this.lakeDistance(x,z),riverDist=this.riverDistance(x,z)-this.config.river.width*.5,coastDist=this.coastDistance(x,z);
  // Carve connected waterways into the actual terrain; submerged vertices stay below surface.
  const carveRiver=1-smoothstep(-2,5,riverDist);
  const carveLake=1-smoothstep(-2,4,lakeDist);
  const carveSea=1-smoothstep(-3,10,coastDist);
  ground=ground*(1-Math.max(carveRiver,carveLake,carveSea)) + (-2.5)*Math.max(carveRiver,carveLake,carveSea);
  // Smooth beaches and shallow water banks.
  if(coastDist>-6&&coastDist<15)ground-=1.6*(1-smoothstep(-6,15,coastDist))*(smoothstep(-6,3,coastDist));
  return ground;
 }
 moisture(x,z){return noise(x*.14,z*.14,this.seed+121);}
 terrainType(x,z){let dist=this.waterDistance(x,z);if(dist<2)return'waterbed';if(dist<8)return'sand';if(this.pathDistance(x,z)<0.9)return'dirt';if(this.parcelAt(x,z))return'plot';return'grass';}
}
