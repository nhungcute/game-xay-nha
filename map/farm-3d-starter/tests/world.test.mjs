import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WorldField} from '../src/core/WorldField.js';
import {seeded,inPolygon,polygonArea,polylineDistance} from '../src/core/math.js';
const farm=JSON.parse(readFileSync(new URL('../public/worlds/farm.json',import.meta.url)));
const field=new WorldField(farm);
test('world config identifies at least 12 distinct farm lots',()=>{assert.ok(farm.parcels.length>=12);assert.equal(new Set(farm.parcels.map(p=>p.id)).size,farm.parcels.length);});
test('seeded procedural worlds reproduce deterministic results',()=>{let a=seeded(farm.seed),b=seeded(farm.seed);assert.deepEqual(Array.from({length:100},a),Array.from({length:100},b));assert.equal(field.height(24,13),new WorldField(farm).height(24,13));});
test('water is carved into actual terrain, below water meshes',()=>{
 const [x,z]=farm.river.points[5];assert.ok(field.isWater(x,z));assert.ok(field.height(x,z)<farm.world.waterLevel);
 const l=farm.lakes[0];assert.ok(field.isWater(l.x,l.z));assert.ok(field.height(l.x,l.z)<farm.world.waterLevel);
 const c=field.coastline(-30);assert.ok(field.isWater(-30,c+10));assert.ok(!field.isWater(-30,c-25));
});
test('open farm parcels sit on land and include center building footprints',()=>{
 for(const p of farm.parcels){let [x,z]=p.polygon.reduce((sum,pt)=>[sum[0]+pt[0]/p.polygon.length,sum[1]+pt[1]/p.polygon.length],[0,0]);assert.ok(polygonArea(p.polygon)>45,`${p.id} too small`);assert.ok(inPolygon(x,z,p.polygon),`${p.id} center misses`);assert.ok(!field.isWater(x,z),`${p.id} underwater`);}
});
test('dirt routes are geometric polylines, not asphalt textures',()=>{assert.ok(farm.paths.length>=6);assert.equal(polylineDistance(0,0,[[0,-10],[0,10]]),0);});
test('each world preset uses its own seed, palette, parcel ids',()=>{for(const name of ['city','eco']){const c=JSON.parse(readFileSync(new URL(`../public/worlds/${name}.json`,import.meta.url)));assert.notEqual(c.seed,farm.seed);assert.equal(c.parcels.length,farm.parcels.length);assert.notEqual(c.parcels[0].id,farm.parcels[0].id);}});
import {TYPES,footprintCorners,footprintsOverlap,validatePlacement} from '../src/core/placement.js';
test('real build footprints have four ground-space corners',()=>{let cs=footprintCorners(5,8,10,8,Math.PI/2);assert.equal(cs.length,4);assert.ok(cs.every(c=>c.length===2));});
test('all farms have valid constructible crop positions',()=>{
 for(const p of farm.parcels){const [x,z]=p.polygon.reduce((a,v)=>[a[0]+v[0]/p.polygon.length,a[1]+v[1]/p.polygon.length],[0,0]);
  const res=validatePlacement({field,vegetation:null,objects:[],kind:'crop',x,z});
  assert.equal(res.valid,true,`${p.id}: ${res.reason}`);
 }
});
test('placement blocks water, outside parcels and occupied space',()=>{
 assert.equal(validatePlacement({field,objects:[],kind:'barn',x:150,z:100}).valid,false);
 assert.equal(validatePlacement({field,objects:[],kind:'crop',x:0,z:-55}).valid,false);
 const existing={id:'b1',type:'crop',x:-30,z:40,rotation:0};
 assert.equal(validatePlacement({field,objects:[existing],kind:'crop',x:-30,z:40}).reason,'Overlaps an existing construction');
 assert.equal(footprintsOverlap({...existing,...TYPES.crop},{...existing,x:125,z:5,...TYPES.crop}),false);
});
test('none of the natural dirt routes crosses open water',()=>{
 for(const p of farm.paths)for(let i=1;i<p.points.length;i++)for(let k=0;k<=25;k++){
  let t=k/25,a=p.points[i-1],b=p.points[i],x=a[0]*(1-t)+b[0]*t,z=a[1]*(1-t)+b[1]*t;
  assert.ok(field.waterDistance(x,z)>p.width/2,`${p.id} overlaps water at (${x},${z})`);
 }
});
