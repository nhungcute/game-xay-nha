"""Browser QA for actual Three.js app after `npm install` and `npm run dev`.

Run: python tests/browser_smoke.py --url http://127.0.0.1:5173
Needs `pip install playwright` and system Chromium (or Playwright Chromium).
A changed screenshot after 90-degree rotation proves geometry is seen from new angles;
this is not a substitute for manual review of every camera angle.
"""
from pathlib import Path
import argparse
import json
from playwright.sync_api import sync_playwright

ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:5173')
ap.add_argument('--chromium',default='/usr/bin/chromium')
args=ap.parse_args()
base=Path(__file__).parent/'screenshots'
base.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path=args.chromium,args=[
      '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--disable-web-security'
    ])
    page=browser.new_page(viewport={'width':1440,'height':900}, device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(args.url,wait_until='domcontentloaded',timeout=30000)
    page.wait_for_function("Boolean(window.__farmDebug)",timeout=60000)
    page.wait_for_timeout(1400)
    info=page.evaluate('window.__farmDebug.summary()')
    assert info['buildingCount']==0,info
    assert info['parcelCount']==16,info
    assert info['terrainVertices']>30000,info
    assert info['vegetationChunks']>5,info
    assert info['waterMeshes']>=3,info
    page.screenshot(path=str(base/'initial.png'))
    before=page.evaluate('window.__farmDebug.camera.position.toArray()')
    page.evaluate('window.__farmDebug.rotateCamera(Math.PI/2)')
    page.wait_for_timeout(650)
    after=page.evaluate('window.__farmDebug.camera.position.toArray()')
    assert any(abs(a-b)>10 for a,b in zip(before,after)),(before,after)
    page.screenshot(path=str(base/'rotated_90_degrees.png'))
    from PIL import Image,ImageChops,ImageStat
    a=Image.open(base/'initial.png').convert('RGB')
    b=Image.open(base/'rotated_90_degrees.png').convert('RGB')
    diff=ImageStat.Stat(ImageChops.difference(a,b))
    average=sum(diff.mean)/3
    assert average>2.0, f'Camera rotated but scene rendered too similarly: {average}'
    # Model geometry must be three dimensional. Test building save/restore lifecycle.
    outcome=page.evaluate("""() => {
      const d=window.__farmDebug,w=d.world,p=w.parcels.find(p=>p.id==='FARM-007');
      const x=p.points.reduce((n,v)=>n+v[0],0)/p.points.length;
      const z=p.points.reduce((n,v)=>n+v[1],0)/p.points.length;
      const obj=d.buildings.add({type:'field',x:Math.round(x),z:Math.round(z),rotation:0,parcelId:p.id});
      const saved=d.buildings.serialize();d.buildings.clear();d.buildings.hydrate(saved);
      const recovered=d.buildings.objects.length;d.buildings.clear();
      return {id:obj.id,recovered,emptyAgain:d.buildings.objects.length};
    }""")
    assert outcome['recovered']==1 and outcome['emptyAgain']==0,outcome
    assert not errors,errors
    print(json.dumps({'status':'PASS','scene':info,'mean_image_difference':round(average,2),'camera_before':before,'camera_after':after,'save_load':outcome},indent=2))
    browser.close()
