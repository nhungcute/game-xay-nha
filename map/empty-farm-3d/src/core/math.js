// Framework-independent geometry and deterministic-world helpers.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, t) => { const x = clamp((t-a)/(b-a),0,1); return x*x*(3-2*x); };
export const lerp = (a,b,t) => a + (b-a)*t;
export function noise(x,z,seed=0) {
  const xi=Math.floor(x), zi=Math.floor(z),u=x-xi,v=z-zi;
  const hash=(a,b) => { const n=Math.sin(a*127.1 + b*311.7 + seed*1.271)*43758.5453;return n-Math.floor(n);};
  const uu=u*u*(3-2*u),vv=v*v*(3-2*v);
  return lerp(lerp(hash(xi,zi),hash(xi+1,zi),uu),lerp(hash(xi,zi+1),hash(xi+1,zi+1),uu),vv);
}
export function segmentDistance(px,pz, ax,az,bx,bz) {
  const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
  const t=l?clamp(((px-ax)*dx+(pz-az)*dz)/l,0,1):0;
  return Math.hypot(px-ax-t*dx,pz-az-t*dz);
}
export function polyContains(x,z,pts) {
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++) {
    const a=pts[i],b=pts[j];
    if((a[1]>z)!==(b[1]>z) && x < (b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function polygonEdgeDistance(x,z,points) {
  let d=Infinity;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    d=Math.min(d,segmentDistance(x,z,a[0],a[1],b[0],b[1]));
  }
  return d;
}
export function centroid(pts) { const sum=pts.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]);return [sum[0]/pts.length,sum[1]/pts.length]; }
export function nearestPolyline(x,z,pts) {
  let min=Infinity;
  for(let i=0;i<pts.length-1;i++) min=Math.min(min,segmentDistance(x,z,...pts[i],...pts[i+1]));
  return min;
}
export function approxEllipseDistance(x,z,l) {
  // Signed approximate distance in world units (negative inside ellipse).
  const r=Math.sqrt(((x-l.x)/l.rx)**2+((z-l.z)/l.rz)**2);
  return (r-1)*Math.min(l.rx,l.rz);
}
export function validatePlacement({x,z,halfX,halfZ,rotation=0},parcel,world,objects=[]) {
  if(!parcel) return {ok:false, reason:'Hãy chọn một lô đất.'};
  const c=Math.cos(rotation),s=Math.sin(rotation);
  for(const [i,j] of [[-1,-1],[-1,1],[1,-1],[1,1],[0,0]]) {
    const a=i*halfX,b=j*halfZ;
    const xx=x+a*c-b*s,zz=z+a*s+b*c;
    if(!polyContains(xx,zz,parcel.points) || polygonEdgeDistance(xx,zz,parcel.points)<0.6) return {ok:false,reason:'Công trình nằm ngoài ranh giới lô đất.'};
    if(world.rivers.some(r=>nearestPolyline(xx,zz,r.points)<r.width+2) || world.lakes.some(l=>approxEllipseDistance(xx,zz,l)<2))
      return {ok:false,reason:'Không được xây trên mặt nước.'};
    if(world.paths.some(p=>nearestPolyline(xx,zz,p.points)<p.width*0.5+1)) return {ok:false,reason:'Vị trí bị chắn bởi đường đất.'};
  }
  for(const o of objects) {
    const r1=Math.hypot(halfX,halfZ),r2=Math.hypot(o.halfX,o.halfZ);
    if(Math.hypot(x-o.x,z-o.z)<r1+r2+0.9) return {ok:false,reason:'Vị trí va chạm với công trình khác.'};
  }
  return {ok:true,reason:'Có thể xây tại đây.'};
}
export function sanitizeSave(raw,world) {
  if(!raw || raw.schemaVersion!==1 || raw.worldId!==world.id || !Array.isArray(raw.objects) || raw.objects.length>300) throw new Error('Dữ liệu lưu không hợp lệ hoặc không khớp bản đồ.');
  const types={field:[3.2,3.2],orchard:[4,4],cottage:[4.4,4],barn:[5.5,4.8]},done=[],ids=new Set();
  for(const o of raw.objects) {
    const size=types[o.type],p=world.parcels.find(p=>p.id===o.parcelId);
    if(!size || !p || !Number.isFinite(o.x)||!Number.isFinite(o.z)||!Number.isFinite(o.rotation)||typeof o.id!=='string'||ids.has(o.id)||o.id.length>100) throw new Error('Có đối tượng không hợp lệ trong file JSON.');
    const verdict=validatePlacement({x:o.x,z:o.z,halfX:size[0],halfZ:size[1],rotation:o.rotation},p,world,done);
    if(!verdict.ok) throw new Error(`Lỗi tại ${o.id}: ${verdict.reason}`);
    ids.add(o.id);done.push({id:o.id,type:o.type,x:o.x,z:o.z,rotation:o.rotation,parcelId:o.parcelId,halfX:size[0],halfZ:size[1]});
  }
  return done;
}
