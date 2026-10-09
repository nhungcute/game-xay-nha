import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {nearestPolyline,approxEllipseDistance} from '../src/core/math.js';
const models=['pine','oak','shrub','rock','rock_warm','flower'];
const root=new URL('../public/assets/models/', import.meta.url);

test('All original tree, shrub, flower and rock assets are binary glTF 2.0',()=>{
  for(const name of models){const path=new URL(name+'.glb',root),content=readFileSync(path);
    assert.equal(content.toString('ascii',0,4),'glTF',name);
    assert.equal(content.readUInt32LE(4),2,name);
    assert.equal(content.readUInt32LE(8),content.length,name);
    assert.ok(content.length>1000,`${name} unexpectedly small`);
  }
  assert.ok(statSync(new URL('LICENSE.md',root)).size>300);
});

test('All dirt paths remain separate from rivers and lakes (no hidden bridges)',()=>{
  const w=JSON.parse(readFileSync(new URL('../public/worlds/farm-valley.json',import.meta.url)));
  for(const p of w.paths){for(let i=0;i<p.points.length-1;i++)for(let j=0;j<=50;j++){
    const t=j/50,x=p.points[i][0]*(1-t)+p.points[i+1][0]*t,z=p.points[i][1]*(1-t)+p.points[i+1][1]*t;
    const clearance=Math.min(...w.rivers.map(r=>nearestPolyline(x,z,r.points)-r.width),...w.lakes.map(l=>approxEllipseDistance(x,z,l)));
    assert.ok(clearance>p.width/2+1,`${p.id} overlaps water at ${x}, ${z} (clearance: ${clearance})`);
  }}
});
