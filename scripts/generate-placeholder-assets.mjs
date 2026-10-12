import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory = new URL('../apps/web/public/assets/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('../packages/content/catalog.v1.json', import.meta.url), 'utf8'));
const assets = [];
const palette = {
  wood: [0.38, 0.22, 0.10], wall: [0.85, 0.69, 0.43], roof: [0.66, 0.20, 0.13],
  leaf: [0.20, 0.43, 0.12], leafLight: [0.40, 0.60, 0.20], rock: [0.48, 0.49, 0.43],
  blue: [0.13, 0.39, 0.57], white: [0.88, 0.86, 0.74], gold: [0.90, 0.59, 0.12],
};
function model() {
  const positions = [], normals = [], colors = [];
  function triangle(a, b, c, color) {
    const u = b.map((value, i) => value - a[i]), v = c.map((value, i) => value - a[i]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...normal);
    for (const vertex of [a, b, c]) { positions.push(...vertex); normals.push(...normal.map(value => value / length)); colors.push(...color); }
  }
  function box(x, y, z, w, h, d, color) {
    const vertices = [[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y+h,z-d/2],[x-w/2,y+h,z-d/2],
      [x-w/2,y,z+d/2],[x+w/2,y,z+d/2],[x+w/2,y+h,z+d/2],[x-w/2,y+h,z+d/2]];
    for (const face of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]) {
      triangle(vertices[face[0]],vertices[face[1]],vertices[face[2]],color);
      triangle(vertices[face[0]],vertices[face[2]],vertices[face[3]],color);
    }
  }
  function cone(x,y,z,r,h,color,sides=7,topRadius=0) {
    for (let i=0;i<sides;i++) {
      const angle = i/sides*Math.PI*2, next = (i+1)/sides*Math.PI*2;
      const a=[x+Math.cos(angle)*r,y,z+Math.sin(angle)*r], b=[x+Math.cos(next)*r,y,z+Math.sin(next)*r];
      const c=[x+Math.cos(angle)*topRadius,y+h,z+Math.sin(angle)*topRadius], d=[x+Math.cos(next)*topRadius,y+h,z+Math.sin(next)*topRadius];
      triangle(a,c,b,color); if(topRadius) triangle(b,c,d,color);
      triangle([x,y,z],a,b,color);
      if(topRadius) triangle([x,y+h,z],d,c,color);
    }
  }
  function roof(w,d,y,h,color) {
    const a=[-w/2,y,-d/2],b=[w/2,y,-d/2],c=[w/2,y,d/2],e=[-w/2,y,d/2],f=[0,y+h,-d/2],g=[0,y+h,d/2];
    triangle(a,f,b,color);triangle(e,c,g,color);triangle(a,e,g,color);triangle(a,g,f,color);triangle(b,f,g,color);triangle(b,g,c,color);
  }
  return {positions,normals,colors,box,cone,roof};
}
function glb(mesh) {
  const attributes = [mesh.positions,mesh.normals,mesh.colors];
  const buffers = attributes.map(values => Buffer.from(new Float32Array(values).buffer));
  const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
  mesh.positions.forEach((value,i)=>{minimum[i%3]=Math.min(minimum[i%3],value);maximum[i%3]=Math.max(maximum[i%3],value);});
  let offset=0;
  const document={asset:{version:'2.0',generator:'Xay Nha placeholder generator'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},material:0}]}],
    materials:[{name:'vertex-palette',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:buffers.reduce((sum,buffer)=>sum+buffer.length,0)}],
    bufferViews:buffers.map(buffer=>{const view={buffer:0,byteOffset:offset,byteLength:buffer.length,target:34962};offset+=buffer.length;return view;}),
    accessors:attributes.map((_values,index)=>({bufferView:index,componentType:5126,count:mesh.positions.length/3,type:'VEC3',...(index===0?{min:minimum,max:maximum}:{})}))};
  const json=Buffer.from(JSON.stringify(document));
  const jsonPadding=Buffer.alloc((4-json.length%4)%4,32), binary=Buffer.concat(buffers);
  const header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binHeader=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+jsonPadding.length+8+binary.length,8);
  jsonHeader.writeUInt32LE(json.length+jsonPadding.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);
  binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return {bytes:Buffer.concat([header,jsonHeader,json,jsonPadding,binHeader,binary]),bounds:{min:minimum,max:maximum},triangles:mesh.positions.length/9};
}
await mkdir(new URL('models/',directory),{recursive:true});
async function save(id,mesh,category,extra={}) {
  const generated=glb(mesh),file=`models/${id}.glb`;
  await writeFile(new URL(file,directory),generated.bytes);
  assets.push({id,file,source:'Procedural low-poly placeholder generated in this repository',author:'Xây Nhà project',
    license:'Project-owned generated asset',url:'scripts/generate-placeholder-assets.mjs',modified:false,placeholder:true,
    category,...extra,bounds:generated.bounds,triangles:generated.triangles});
}
for (const [category,count] of [['tree_deciduous',4],['tree_conifer',4],['bush',4],['rock',4],['rock_large',2],['reed',3],['flower',4],['grass_tuft',3]]) {
  for(let variant=1;variant<=count;variant++) {
    const m=model(),v=variant-1;
    if(category.startsWith('tree')) {
      const height=3.5+v*.4;
      m.cone(0,0,0,.20,height*.65,palette.wood,6,.14);
      if(category==='tree_conifer') for(let tier=0;tier<3;tier++) m.cone(0,1+tier*.8,0,1.1-tier*.2,height*.55,palette.leaf,7);
      else {m.cone(0,height*.42,0,1.1+v*.07,height*.55,palette.leaf,7,.55);m.cone(0,height*.82,0,.75,height*.35,palette.leafLight,7);}
    } else if(category.startsWith('rock')) {
      const radius=category==='rock_large'?1.55:.72;
      m.cone(0,0,0,radius,.65+v*.13,palette.rock,6,radius*.7);m.cone(0,.65+v*.13,0,radius*.7,.3,palette.rock,6,.15);
    } else if(category==='bush') {
      m.cone(0,0,0,.75,.7+v*.1,palette.leaf,7,.4);m.cone(.2,.6,0,.4,.4,palette.leafLight,6);
    } else {
      for(let i=0;i<3;i++){const x=(i-1)*.24,z=(i%2)*.22; m.cone(x,0,z,.07,category==='reed'?1.4:.35,palette.leafLight,4);
        if(category==='flower')m.cone(x,.30,z,.15,.12,v%2?palette.gold:palette.white,5);}
    }
    await save(`${category}_${String(variant).padStart(2,'0')}`,m,'environment');
  }
}
for(const def of Object.values(catalog.buildings)) {
  const m=model(),w=def.size[0]*2*.88,d=def.size[1]*2*.88,id=def.id;
  if(id.includes('deco')) {
    m.box(0,0,0,w,.12,d,palette.wood);
    for(const x of [-w*.25,w*.25])for(const z of [-d*.25,d*.25])m.cone(x,.12,z,Math.min(w,d)*.16,.5,palette.leafLight,5);
  } else if(id==='well') {
    m.cone(0,0,0,.7,.6,palette.rock,8,.7);m.box(-.55,.5,0,.12,1.1,.12,palette.wood);m.box(.55,.5,0,.12,1.1,.12,palette.wood);m.roof(w,d,1.5,.45,palette.roof);
  } else if(id==='silo') {
    m.cone(0,0,0,w*.4,3,palette.white,10,w*.4);m.cone(0,3,0,w*.4,.8,palette.roof,10);
  } else {
    const height=id==='office_tower'?12:id==='hotel'?8:id==='house_apartment'?7:id==='bank'?4:2.3;
    m.box(0,0,0,w,height,d,palette.wall);
    if(height>5)m.box(0,height,0,w*.95,.4,d*.95,palette.blue);else m.roof(w,d,height,1.2,palette.roof);
    m.box(0,0,-d/2-.015,Math.min(.8,w*.22),1.5,.05,palette.wood);
    for(let y=1.0;y<height-.3;y+=1.6)for(const x of [-w*.30,w*.30])m.box(x,y,-d/2-.02,.65,.7,.06,palette.blue);
    if(id==='rice_mill'){m.box(0,height+1,-d/2-.08,.16,2.2,.12,palette.white);m.box(0,height+1.9,-d/2-.08,2.2,.16,.12,palette.white);}
    if(id==='market'||id.startsWith('shop'))m.box(0,1.7,-d*.47,w*.95,.22,.5,palette.gold);
  }
  await save(id,m,'building',{footprint:def.size});
}
for(const def of Object.values(catalog.crops))for(let stage=0;stage<3;stage++) {
  const m=model(),height=.12+stage*.27;
  for(const [x,z]of [[-.4,-.4],[.4,-.4],[-.4,.4],[.4,.4]]) {
    m.cone(x,0,z,.14+stage*.04,height,palette.leafLight,5);
    if(stage===2)m.cone(x,height*.5,z,.17,.18,def.id==='tomato'?palette.roof:palette.gold,6);
  }
  await save(def.stageModels[stage],m,'crop');
}
const scaffold=model();
for(const x of [-.46,.46])for(const z of [-.46,.46])scaffold.box(x,0,z,.07,1,.07,palette.wood);
for(const y of [.3,.7]){scaffold.box(0,y,-.46,1,.05,.07,palette.gold);scaffold.box(0,y,.46,1,.05,.07,palette.gold);scaffold.box(-.46,y,0,.07,.05,1,palette.gold);scaffold.box(.46,y,0,.07,.05,1,palette.gold);}
await save('construction_scaffold',scaffold,'construction');
// D029: 20 buildings use models imported from the owner's Bo_21_Mo_Hinh_3D_GLTF_Day_Du pack by
// scripts/import-model-pack.mjs, which pre-fits them (one mesh/material, flat normals, vertex colours,
// 2 m/cell, door facing -Z, bottom-centre pivot) — no load-time fitting needed. The silo keeps its
// placeholder: rural_warehouse is a 4×3 barn, the wrong silhouette for a 2×2 silo (D029 decision).
const AUTHORED = ['house_small', 'shop_grocery', 'house_town', 'shop_cafe', 'shop_restaurant', 'bank', 'house_apartment',
  'office_tower', 'hotel', 'shop_supermarket', 'deco_garden', 'deco_park', 'farmhouse', 'market', 'well',
  'chicken_coop', 'rice_mill', 'cow_barn', 'bakery', 'deco_flowerbed'];
for (const id of AUTHORED) {
  const entry = assets.find(asset => asset.id === id), bytes = await readFile(new URL(`models/authored/${id}.glb`, directory));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  const triangles = json.meshes.flatMap(mesh => mesh.primitives).reduce((sum, p) => sum + json.accessors[p.attributes.POSITION].count / 3, 0);
  Object.assign(entry, { file: `models/authored/${id}.glb`, source: 'Bo_21_Mo_Hinh_3D_GLTF_Day_Du pack (owner-supplied procedural GLTF), imported by scripts/import-model-pack.mjs',
    author: 'Project owner (procedural generator sources/build_assets.py)', license: 'original_procedural_geometry_and_textures (map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du/LICENSES.md)',
    url: 'map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du', modified: true, placeholder: false, triangles });
  delete entry.bounds;
}
// D030: 12 environment ids use tree/bush GLBs imported from the owner's map/tree pack by
// scripts/import-trees.mjs — a near LOD (one mesh, one atlas material) plus a crossed-plane billboard far
// LOD per id (`<id>_far`). Conifer derivatives are CC-BY-SA and live in models/env-by-sa/ next to their
// LICENSE.md. The config is generated by the import script; absent (fresh CI without map/tree), the
// placeholder entries above stay.
const TREES_CONFIG = new URL('../scripts/trees.config.json', import.meta.url);
if (existsSync(TREES_CONFIG)) {
  const trees = JSON.parse(await readFile(TREES_CONFIG, 'utf8'));
  for (const [id, model] of Object.entries(trees.models)) {
    const entry = assets.find(asset => asset.id === id);
    if (!entry) throw new Error(`manifest: no placeholder entry for tree ${id}`);
    const credits = { source: model.url, author: model.author, license: model.license, url: model.url, modified: true, placeholder: false };
    const rel = path => path.replace('apps/web/public/assets/', '');
    Object.assign(entry, { file: rel(model.file), ...credits, triangles: model.nearTriangles, lod: { far: `${id}_far` } });
    delete entry.bounds;
    assets.push({ id: `${id}_far`, file: rel(model.farFile), category: 'environment', ...credits, triangles: model.farTriangles });
  }
}
// D032: replace only the six existing rock ids when the deterministic Stone Pack import is available. The
// source pack is intentionally untracked, so a clean CI checkout keeps the generated placeholders instead.
const ROCKS_CONFIG = new URL('../scripts/rocks.config.json', import.meta.url);
if (existsSync(ROCKS_CONFIG)) {
  const rocks = JSON.parse(await readFile(ROCKS_CONFIG, 'utf8'));
  for (const [id, model] of Object.entries(rocks.models)) {
    const entry = assets.find(asset => asset.id === id);
    if (!entry) throw new Error(`manifest: no placeholder entry for rock ${id}`);
    const credits = { source: rocks.credits.url, author: rocks.credits.author, license: rocks.credits.license,
      url: rocks.credits.url, modified: true, placeholder: false };
    const rel = path => path.replace('apps/web/public/assets/', '');
    Object.assign(entry, { file: rel(model.file), ...credits, triangles: model.triangles });
    delete entry.bounds;
  }
}
// D035: streetlight imported from map/street_light.glb (Street_Light by dodotcreatives, CC-BY-4.0)
// by scripts/import-streetlight.mjs
const STREETLIGHT_CONFIG = new URL('../scripts/streetlight.config.json', import.meta.url);
if (existsSync(STREETLIGHT_CONFIG)) {
  const streetlight = JSON.parse(await readFile(STREETLIGHT_CONFIG, 'utf8'));
  const entry = assets.find(asset => asset.id === 'deco_streetlight');
  if (entry) {
    const credits = { source: streetlight.credits.url, author: streetlight.credits.author, license: streetlight.credits.license,
      url: streetlight.credits.url, modified: true, placeholder: false };
    Object.assign(entry, { file: 'models/authored/deco_streetlight.glb', ...credits, triangles: streetlight.triangles });
    delete entry.bounds;
  }
}
// Content version per file: the client requests `file?v=<hash>`, so a re-imported model is fetched again even when a
// browser still holds the old bytes under the same path (models are cached for a day; D031 windows were missed so).
for (const asset of assets) asset.hash=createHash('sha256').update(await readFile(new URL(asset.file,directory))).digest('hex').slice(0,12);
await writeFile(new URL('manifest.json',directory),`${JSON.stringify({version:1,placeholder:assets.every(asset=>asset.placeholder),assets},null,2)}\n`);
console.log(`Generated ${assets.length} actual GLB placeholder assets; every source/license is recorded in assets/manifest.json.`);
