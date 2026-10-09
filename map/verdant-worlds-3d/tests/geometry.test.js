import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pointInPoly,insideFootprint,polygonCenter,rectsOverlap,rng,hash32,edgeDistance,polylineDistance,noise} from '../src/core/math.js';
const worlds=Object.fromEntries(['farm','city','eco'].map(k=>[k,JSON.parse(fs.readFileSync(`public/worlds/${k}.json`,'utf8'))]));
test('world JSON: starter maps are empty and no bridge/building objects exist',()=>{
  for(const [id,w] of Object.entries(worlds)){
    assert.equal(w.mapId,id);assert.equal(w.schemaVersion,1);assert.ok(w.parcels.length>10);assert.equal(w.buildings,undefined);
    assert.equal(new Set(w.parcels.map(p=>p.id)).size,w.parcels.length);
    for(const p of w.parcels)assert.ok(p.points.length>=8);
    for(const path of w.paths)assert.ok(path.width<3);
  }
});
test('every farm starter parcel centroid is above dry land, away from river channels',()=>{
  const w=worlds.farm;
  for(const p of w.parcels){
    const [x,z]=polygonCenter(p.points);
    for(const l of w.water)assert.ok(!pointInPoly(x,z,l.points),`${p.id} overlaps lake ${l.id}`);
    for(const r of w.rivers)assert.ok(polylineDistance(x,z,r.points)>=r.width/2,`${p.id} submerged in ${r.id}`);
  }
});
test('point in polygon and rectangle placement constraints',()=>{
  const square=[[-5,-5],[5,-5],[5,5],[-5,5]];
  assert.equal(pointInPoly(0,0,square),true);assert.equal(pointInPoly(20,0,square),false);
  assert.ok(insideFootprint(0,0,3,3,square));assert.ok(!insideFootprint(3,3,3,3,square));
  assert.equal(rectsOverlap({x:0,z:0,width:6,depth:4,rotation:0},{x:2,z:0,width:6,depth:4,rotation:0}),true);
  assert.equal(rectsOverlap({x:0,z:0,width:6,depth:4,rotation:0},{x:14,z:0,width:6,depth:4,rotation:0}),false);
});
test('deterministic seeds return identical noise and placement order',()=>{
  const a=rng(hash32(20261009,'chunk4')),b=rng(hash32(20261009,'chunk4'));
  for(let i=0;i<100;i++)assert.equal(a(),b());
  assert.equal(noise(11.23,42.7,1337),noise(11.23,42.7,1337));
});
test('edgeDistance and polylineDistance match known geometry',()=>{
  const box=[[0,0],[10,0],[10,10],[0,10]];
  assert.equal(edgeDistance(5,5,box),5);
  assert.equal(polylineDistance(3,4,[[0,0],[10,0]]),4);
});
