"""Create ORIGINAL, geometry-only vertex-colored GLBs; dedicated to CC0 1.0."""
from pathlib import Path
import math
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix

ROOT=Path(__file__).resolve().parents[1]/'public'/'assets'
ROOT.mkdir(parents=True,exist_ok=True)

def tint(hexcode,alpha=255):
 return np.array([int(hexcode[i:i+2],16) for i in (1,3,5)]+[alpha],dtype=np.uint8)

def color_mesh(mesh,color):
 mesh.visual.vertex_colors=np.tile(tint(color), (len(mesh.vertices),1))
 return mesh

def cylinder(radius,height,y,x=0,z=0,color='#816348',sections=9):
 mesh=trimesh.creation.cone(radius,height,sections=sections) if False else trimesh.creation.cylinder(radius,height,sections=sections)
 mesh.apply_transform(rotation_matrix(math.pi/2,[1,0,0])); mesh.apply_translation([x,y,z]);return color_mesh(mesh,color)

def cone(radius,height,base_y,color,sections=9,x=0,z=0):
 mesh=trimesh.creation.cone(radius,height,sections=sections)
 mesh.apply_transform(rotation_matrix(-math.pi/2,[1,0,0]));mesh.apply_translation([x,base_y+height*.5,z]);return color_mesh(mesh,color)

def rock(x,y,z,sx,sy,sz,c,sub=0):
 mesh=trimesh.creation.icosphere(subdivisions=sub,radius=1)
 mesh.apply_scale([sx,sy,sz]);mesh.apply_translation([x,y,z]); return color_mesh(mesh,c)

def make_pine():
 parts=[cylinder(.30,2.5,1.25,color='#735b3e')]
 for k,(rad,base,h,col) in enumerate([(2.0,1.0,3.1,'#245b42'),(1.75,2.55,3.1,'#2d7850'),(1.32,4.12,2.7,'#377f55'),(.91,5.45,2.1,'#4a9362')]):
  parts.append(cone(rad,h,base,col,10))
 return parts

def make_oak():
 parts=[cylinder(.38,3.9,1.95,color='#775638',sections=8)]
 for x,y,z,sz,c in [(0,5.1,0,2.55,'#598e45'),(-1.3,4.5,.25,1.8,'#679c4c'),(1.3,4.6,-.1,1.9,'#42844a'),(.2,5.9,.8,1.75,'#75a851'),(-.35,6.4,-.65,1.48,'#5e9f4c')]:
  parts.append(rock(x,y,z,sz,sz*.78,sz*.85,c,1))
 return parts

def make_boulder():
 return [rock(0,.65,0,1.3,.8,1.05,'#828b82',0),rock(.44,.35,-.13,.62,.46,.54,'#a2a69a',0),rock(-.5,.30,.36,.55,.41,.53,'#737e76',0)]

def make_shrub():
 return [rock(-.4,.48,0,.75,.7,.7,'#4e8b42',1),rock(.38,.43,.25,.78,.6,.77,'#5f9a49',1),rock(.1,.68,-.28,.68,.72,.7,'#78ae51',1)]

for name,func in [('conifer',make_pine),('oak',make_oak),('boulder',make_boulder),('shrub',make_shrub)]:
 meshes=func();joint=trimesh.util.concatenate(meshes)
 joint.metadata['copyright']='Original procedural geometry - CC0 1.0'
 scene=trimesh.Scene();scene.add_geometry(joint,geom_name=name)
 raw=trimesh.exchange.gltf.export_glb(scene)
 (ROOT/(name+'.glb')).write_bytes(raw)
 print(name,len(raw),'bytes',len(joint.vertices),'vertices')
