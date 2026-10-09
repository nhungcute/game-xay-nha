import json, math, random
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'public/worlds'
p.mkdir(parents=True,exist_ok=True)
r=random.Random(17)

def ellipse(x,z,rx,rz,n=24,jitter=.07,phase=0):
    return [[round(x+math.cos(i*2*math.pi/n+phase)*rx*(1+r.uniform(-jitter,jitter)),2),round(z+math.sin(i*2*math.pi/n+phase)*rz*(1+r.uniform(-jitter,jitter)),2)] for i in range(n)]

def world(kind,seed):
  global r
  r=random.Random(seed)
  if kind=='farm':
    water=[
      dict(id='bluewater-lake',level=.65,points=ellipse(-1,-1,43,26,42,.105,.1)),
      dict(id='western-lagoon',level=.65,points=ellipse(-78,61,36,20,32,.12)),
      dict(id='eastern-wetland',level=.65,points=ellipse(90,-49,19,25,28,.1)),
    ]
    rivers=[
      dict(id='northwest-creek',width=6.6,level=.69,points=[[-88,-80],[-77,-67],[-62,-55],[-51,-40],[-43,-26],[-39,-14]]),
      dict(id='eastern-outlet',width=6,level=.67,points=[[35,12],[48,19],[62,31],[70,44],[88,55],[108,58]]),
      dict(id='southern-channel',width=7.8,level=.67,points=[[-33,19],[-42,32],[-46,44],[-56,52],[-71,63]]),
    ]
    specs=[(-96,-55,7.26,10.44),(-37,-61,13,11),(-6,-57,18,12),(35,-59,16,12),(58,-65,11,10),
       (-88,-27,13,14),(-64,-26,13,11),(59,-24,11,10),(91,-5,9,9),
       (-82,6,15,12),(-61,9,13,12),(64,8,13,11),(86,19,11,12),
       (-90,29,11,9),(-64,30,10,10),(-24,43,13,10),(12,39,16,13),(43,43,16,13),
       (-19,65,9,9),(8,68,16,10),(42,70,13,9),(74,68,12,9)]
    decor={'trees':0.63,'shrubs':0.76,'rocks':0.23,'reeds':0.8,'flowers':0.8}
    accent='Farm Valley'
  elif kind=='eco':
    water=[dict(id='central-lake',level=.65,points=ellipse(-4,-5,49,35,48,.11)),dict(id='forest-lake',level=.65,points=ellipse(-75,55,32,17,28,.1))]
    rivers=[dict(id='forest-river',width=7,level=.67,points=[[-107,-62],[-84,-49],[-71,-34],[-58,-21],[-48,-12]]),dict(id='south-flow',width=8,level=.67,points=[[30,12],[43,29],[56,43],[70,58],[88,81]])]
    specs=[(-72,-61,17,12),(-37,-62,17,12),(-1,-59,16,11),(38,-57,15,13),(70,-60,16,13),(-87,-20,13,12),(-64,0,13,11),(71,-22,17,12),(86,10,13,14),(-87,26,13,12),(-60,32,13,12),(68,33,18,12),(-29,48,12,10),(7,51,17,10),(39,58,16,11),(0,72,14,8)]
    decor={'trees':.79,'shrubs':.86,'rocks':.25,'reeds':1.25,'flowers':1.15};accent='Eco Sanctuary'
  else:
    water=[dict(id='river-basin',level=.65,points=ellipse(72,-54,23,15,32,.09))]
    rivers=[dict(id='east-river',width=8,level=.67,points=[[73,-80],[63,-54],[66,-22],[78,9],[75,38],[86,80]])]
    specs=[(x,z,12.5,10) for z in [-64,-36,-8,20,49,70] for x in [-84,-55,-26,3,32] if not (z==70 and x==-84)]
    decor={'trees':.43,'shrubs':.55,'rocks':.13,'reeds':.35,'flowers':.47};accent='City Frontier'
  parcels=[]
  for i,(x,z,rx,rz) in enumerate(specs):
    pts=ellipse(x,z,rx,rz,24,.06,phase=(i%5)*.03)
    parcels.append(dict(id=f'{kind.upper()}-{i+1:03d}',label=f'Lot {i+1:02d}',type='meadow' if i%4 else 'cleared',points=pts))
  data={
    'schemaVersion':1,'mapId':kind,'title':accent,'seed':seed,
    'size':{'width':220,'depth':168},
    'terrain':{'resolution':184,'baseHeight':1.6,'hills': 1.0 if kind=='city' else 2.7},
    'water':water,'rivers':rivers,'parcels':parcels,
    'islands': ([{'id':'fern-islet','waterLevel':.65,'points':ellipse(-6,-5,6,4,18,.12)}, {'id':'little-bay','waterLevel':.65,'points':ellipse(20,5,4.6,3.7,17,.1)}, {'id':'lagoon-islet','waterLevel':.65,'points':ellipse(-81,61,6.5,4,19,.1)}] if kind=='farm' else [{'id':'eco-islet','waterLevel':.65,'points':ellipse(7,-2,6.3,4.2,20,.1)}] if kind=='eco' else []),
    'paths':[],
    'nature':{'density':decor,'chunkSize':33,'maxVisibleDistance':145},
    'palette': {'soil':'#c89b66','meadow':'#91b85a','cleared':'#d1b477','lake':'#218cb7','deepWater':'#12749b'},
    'camera':{'position':[144,153,166], 'target':[0,0,0]},
    'description':'Original geometry-driven world. All water, flora, rocks, fields and dirt tracks are real meshes.'
  }
  # extra wandering trails connect visible empty lots via upland border corridors
  if kind=='farm':
    data['paths']=[
     {'id':'north-loop','width':1.75,'points':[[-106,-72],[-88,-71],[-64,-78],[-28,-77],[3,-79],[40,-78],[89,-76],[111,-67]]},
     {'id':'west-trail','width':1.55,'points':[[-104,-14],[-98,8],[-102,29],[-103,46]]},
     {'id':'east-trail','width':1.5,'points':[[106,-37],[103,-7],[108,25],[103,43],[104,79]]},
     {'id':'south-trail','width':1.6,'points':[[-44,80],[-12,82],[23,83],[55,82],[88,80]]},
    ]
  (p/(kind+'.json')).write_text(json.dumps(data,indent=2)+'\n')
  print(kind,len(parcels),'lots',len(water),'lakes',len(rivers),'rivers')
for i,k in enumerate(['farm','city','eco']):world(k,20261009+i*237)
