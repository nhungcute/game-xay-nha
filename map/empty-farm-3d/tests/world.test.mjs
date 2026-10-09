import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seeded,polyContains,nearestPolyline,approxEllipseDistance,validatePlacement,sanitizeSave,centroid} from '../src/core/math.js';
const world=JSON.parse(readFileSync(new URL('../public/worlds/farm-valley.json', import.meta.url),'utf8'));

test('Every farm parcel has a unique ID and enough space',()=>{
  assert.equal(new Set(world.parcels.map(p=>p.id)).size,world.parcels.length);
  assert.ok(world.parcels.length>=12);
  for(const p of world.parcels){assert.ok(p.points.length>=4);assert.ok(polyContains(...centroid(p.points),p.points),`${p.id} center should be inside`);}
});
test('World data has rivers, separate ponds, wilderness and no starter buildings',()=>{
  assert.ok(world.rivers.length>=1);assert.ok(world.lakes.length>=2);
  assert.equal(world.buildings?.length??0,0);assert.equal(world.paths.some(p=>p.material==='asphalt'),false);
  assert.ok(world.vegetation.pine>0);
});
test('Fixed seed deterministically generates the same sequence',()=>{
  const a=seeded(world.seed),b=seeded(world.seed);
  for(let i=0;i<100;i++)assert.equal(a(),b());
});
test('Geometry helpers correctly exclude water and identify polygons',()=>{
  assert.ok(nearestPolyline(-14,-110,world.rivers[0].points)<10);
  assert.ok(approxEllipseDistance(53,45,world.lakes[1])<0);
  const p=world.parcels[0];assert.ok(polyContains(...centroid(p.points),p.points));
  assert.equal(polyContains(200,200,p.points),false);
});
test('Build placements validate footprints, parcel edges, water and collisions',()=>{
  const p=world.parcels.find(p=>p.id==='FARM-007'),[x,z]=centroid(p.points);
  const q=validatePlacement({x,z,halfX:3.2,halfZ:3.2,rotation:0},p,world,[]);
  assert.equal(q.ok,true,JSON.stringify(q));
  const collide=validatePlacement({x,z,halfX:3.2,halfZ:3.2,rotation:0},p,world,[{x,z,halfX:3.2,halfZ:3.2}]);
  assert.equal(collide.ok,false);
  const outside=validatePlacement({x:999,z:999,halfX:2,halfZ:2},p,world,[]);
  assert.equal(outside.ok,false);
});
test('Save import validates schema, world, coordinates and overlapping objects',()=>{
  const p=world.parcels.find(p=>p.id==='FARM-007'),[x,z]=centroid(p.points);
  const save={schemaVersion:1,worldId:world.id,objects:[{id:'OBJ-00001',type:'field',parcelId:p.id,x,z,rotation:0}]};
  assert.equal(sanitizeSave(save,world).length,1);
  assert.throws(()=>sanitizeSave({...save,worldId:'city'},world));
  assert.throws(()=>sanitizeSave({...save,objects:[...save.objects,...save.objects]},world));
  assert.throws(()=>sanitizeSave({...save,objects:[{...save.objects[0],x:999}]},world));
});

test('Every plot has a construction-ready central area without road or water collisions',()=>{
  for(const p of world.parcels){
    const [x,z]=centroid(p.points);
    const result=validatePlacement({x,z,halfX:3.2,halfZ:3.2,rotation:0},p,world,[]);
    assert.equal(result.ok,true,`${p.id}: ${result.reason}`);
  }
});
