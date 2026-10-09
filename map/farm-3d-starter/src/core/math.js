export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a+(b-a)*t;
export const smoothstep=(a,b,v)=>{ const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
export function hash(n){let t=n>>>0;t=Math.imul(t^(t>>>16),0x7feb352d);t=Math.imul(t^(t>>>15),0x846ca68b);return (t^(t>>>16))>>>0;}
export function seeded(seed){let s=hash(seed);return ()=>{s=(s+0x6d2b79f5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export function noise(x,z,seed=1){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);const h=(a,b)=>(hash(Math.imul(a,73856093)^Math.imul(b,19349663)^seed)/4294967295)*2-1;return mix(mix(h(ix,iz),h(ix+1,iz),u),mix(h(ix,iz+1),h(ix+1,iz+1),u),v);}
export function polylineDistance(x,z,points){let best=Infinity;for(let i=1;i<points.length;i++){const [ax,az]=points[i-1],[bx,bz]=points[i],dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz));}return best;}
export function interpolateX(points,x){if(x<=points[0][0])return points[0][1];for(let i=1;i<points.length;i++)if(x<=points[i][0]){let t=(x-points[i-1][0])/(points[i][0]-points[i-1][0]);return mix(points[i-1][1],points[i][1],t);}return points.at(-1)[1];}
export function inPolygon(x,z,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){let [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;}return inside;}
export function polygonArea(poly){let n=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];n+=a[0]*b[1]-b[0]*a[1];}return Math.abs(n)/2;}
export function pointSegmentDistance(x,z,ax,az,bx,bz){let dx=bx-ax,dz=bz-az;let t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-(ax+t*dx),z-(az+t*dz));}
export function polygonEdgeDistance(x,z,poly){let min=Infinity;for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length];min=Math.min(min,pointSegmentDistance(x,z,...a,...b));}return min;}
