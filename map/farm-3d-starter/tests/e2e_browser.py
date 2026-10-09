"""Run after `npm install` and `npm run dev -- --port 5173`.
Requires: pip install playwright; python -m playwright install chromium
This test opens the actual rendered page in Chromium, rotates the camera,
and screenshots two distinct viewpoints to reveal possible flat 2D facades.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

BASE='http://127.0.0.1:5173/?world=farm'
OUT=Path(__file__).resolve().parents[1]/'screenshots'
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto(BASE,wait_until='domcontentloaded',timeout=30000)
 page.wait_for_function("window.__FARM_WORLD_DEBUG__ && window.__FARM_WORLD_DEBUG__.getStatus().glb===4",timeout=60000)
 status=page.evaluate('window.__FARM_WORLD_DEBUG__.getStatus()')
 assert status['buildings']==0,status
 assert status['parcels']==14,status
 assert status['chunks']>0,status
 assert status['realGeometry'],status
 features=page.evaluate('''() => {
   const c=window.__FARM_WORLD_DEBUG__;
   let triangles=0,meshCount=0,instanced=0,hasImageBillboard=false;
   c.scene.traverse(o=>{
     if(o.isMesh){meshCount++;triangles+=o.geometry.index ? o.geometry.index.count/3 : o.geometry.attributes.position.count/3;
       if(o.isInstancedMesh)instanced+=o.count;
       if(o.material?.map?.image?.src?.includes('reference'))hasImageBillboard=true;
     }
   });
   return{triangles,meshCount,instanced,hasImageBillboard,water:c.scene.getObjectByName('Water')?.children?.length};
 }''')
 assert features['triangles']>10000,features
 assert features['instanced']>300,features
 assert features['water']>=4,features
 assert not features['hasImageBillboard'],features
 page.screenshot(path=str(OUT/'farm_isometric.png'),full_page=True)
 view=page.evaluate('window.__FARM_WORLD_DEBUG__.rotateTest()')
 assert view['before']!=view['after'],view
 assert view['terrainMeshes']>0,view
 page.wait_for_timeout(1100)
 page.screenshot(path=str(OUT/'farm_rotated_real_3d.png'),full_page=True)
 page.locator('[data-action="iso"]').click()
 page.locator('[data-tool="crop"]').click()
 before=page.evaluate("window.__FARM_WORLD_DEBUG__.validateAt(-30,40,'crop')")
 assert before['valid'],before
 pixel=page.evaluate('''() => {
   const g=window.__FARM_WORLD_DEBUG__,pt=g.controls.target.clone().set(-30,g.field.height(-30,40),40).project(g.camera);
   const rect=document.querySelector('#game-canvas').getBoundingClientRect();
   return {x:rect.left+(pt.x+1)*rect.width/2,y:rect.top+(1-pt.y)*rect.height/2};
 }''')
 page.mouse.click(pixel['x'],pixel['y'])
 assert page.evaluate('window.__FARM_WORLD_DEBUG__.getStatus().buildings')==1,'Click did not create construction'
 page.mouse.click(pixel['x'],pixel['y'])
 assert page.evaluate('window.__FARM_WORLD_DEBUG__.getStatus().buildings')==1,'Collision permitted overlapping placements'
 b=page.evaluate("window.__FARM_WORLD_DEBUG__.validateAt(-30,40,'crop')")
 assert not b['valid'] and 'overlaps' in b['reason'].lower(),b
 sav=page.evaluate('window.__FARM_WORLD_DEBUG__.save()')
 assert len(sav['buildings'])==1,sav
 count=page.evaluate(f'window.__FARM_WORLD_DEBUG__.restore({json.dumps(sav)})')
 assert count==1,count
 assert not errors,errors
 print('PASS browser: WebGL geometry, GLB instancing, water meshes, 180° camera orbit, screenshots, construction collision, save/load')
 print('World:',status)
 print('Geometry:',features)
 print('Screenshots:',OUT/'farm_isometric.png',OUT/'farm_rotated_real_3d.png')
 mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,has_touch=True,is_mobile=True)
 mobile.goto(BASE,wait_until='domcontentloaded',timeout=30000)
 mobile.wait_for_function("window.__FARM_WORLD_DEBUG__ && window.__FARM_WORLD_DEBUG__.getStatus().glb===4",timeout=60000)
 assert mobile.locator('#game-canvas').is_visible()
 assert mobile.locator('[data-tool="crop"]').is_visible()
 mobile.screenshot(path=str(OUT/'farm_mobile.png'),full_page=True)
 print('PASS responsive touch viewport screenshot:', OUT/'farm_mobile.png')
 browser.close()
