/** Deterministic gameplay-side geometry and RNG. No graphics dependency. */
export function hash32(...items) {
  let h = 2166136261;
  for (const item of items) {
    const s = String(item);
    for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h=Math.imul(h,16777619); }
  }
  return h >>> 0;
}
export function rng(seed) {
  let a=seed>>>0;
  return () => { a=(a+0x6D2B79F5)>>>0; let t=Math.imul(a^(a>>>15),1|a); t^=t+Math.imul(t^(t>>>7),61|t); return ((t^(t>>>14))>>>0)/4294967296; };
}
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const smooth=(a,b,x)=>{let t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export const lerp=(a,b,t)=>a+(b-a)*t;
export function pointInPoly(x,z,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,zi]=poly[i], [xj,zj]=poly[j];
    if(((zi>z)!==(zj>z)) && x<(xj-xi)*(z-zi)/(zj-zi)+xi) inside=!inside;
  }
  return inside;
}
export function segmentDistance(x,z,ax,az,bx,bz) {
  const dx=bx-ax,dz=bz-az,dd=dx*dx+dz*dz;
  const t=dd>1e-9?clamp(((x-ax)*dx+(z-az)*dz)/dd,0,1):0;
  return Math.hypot(x-ax-t*dx,z-az-t*dz);
}
export function edgeDistance(x,z,polygon) {
  let d=Infinity;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    d=Math.min(d,segmentDistance(x,z,a[0],a[1],b[0],b[1]));
  }
  return d;
}
export function polylineDistance(x,z,pts) {
  let d=Infinity;
  for(let i=0;i<pts.length-1;i++) d=Math.min(d,segmentDistance(x,z,...pts[i],...pts[i+1]));
  return d;
}
export function polygonCenter(poly) {return poly.reduce((o,p)=>[o[0]+p[0]/poly.length,o[1]+p[1]/poly.length],[0,0]);}
export function insideFootprint(x,z,halfW,halfD,poly,rotation=0) {
  const a=rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const local=[[0,0],[-halfW,-halfD],[-halfW,halfD],[halfW,-halfD],[halfW,halfD]];
  return local.every(([dx,dz])=>pointInPoly(x+dx*c-dz*s,z+dx*s+dz*c,poly));
}
export function rectsOverlap(a,b,gap=.6){
  const aw=a.rotation%180===90?a.depth:a.width, ad=a.rotation%180===90?a.width:a.depth;
  const bw=b.rotation%180===90?b.depth:b.width, bd=b.rotation%180===90?b.width:b.depth;
  return Math.abs(a.x-b.x)<(aw+bw)/2+gap&&Math.abs(a.z-b.z)<(ad+bd)/2+gap;
}
export function noise(x,z,seed=1){
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
  const n=(xx,zz)=>hash32(seed,xx,zz)/0xffffffff;
  const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  return lerp(lerp(n(ix,iz),n(ix+1,iz),u),lerp(n(ix,iz+1),n(ix+1,iz+1),u),v)*2-1;
}
export function fbm(x,z,seed){return .53*noise(x,z,seed)+.27*noise(x*2.13,z*2.13,seed+1)+.13*noise(x*4.37,z*4.37,seed+2)+.07*noise(x*8.71,z*8.71,seed+3);}
