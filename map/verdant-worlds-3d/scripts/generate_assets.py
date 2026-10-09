#!/usr/bin/env python3
"""Create original low-poly glTF 2.0 vegetation/rock assets. No external mesh sources."""
from pathlib import Path
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix
OUT=Path(__file__).resolve().parents[1]/'public/assets/models'
OUT.mkdir(parents=True,exist_ok=True)

def mesh_color(mesh,rgba):
    mesh.visual.vertex_colors=np.tile(np.array(rgba,dtype=np.uint8),(len(mesh.vertices),1))
    return mesh

def sphere(center,radii,col,sub=1):
    m=trimesh.creation.icosphere(subdivisions=sub,radius=1)
    m.apply_scale(radii)
    m.apply_translation(center)
    return mesh_color(m,col)

def trunk(height=3,r=.14,col=(111,77,48,255)):
    m=trimesh.creation.cone(radius=r*1.65,height=height,sections=7)
    # cone is centered, make point about y after rotating z to y
    m.apply_transform(rotation_matrix(-np.pi/2,[1,0,0]))
    m.apply_translation([0,0,0])
    return mesh_color(m,col)

def upright_cone(height,radius,base_y,color):
    m=trimesh.creation.cone(radius=radius,height=height,sections=8)
    m.apply_transform(rotation_matrix(-np.pi/2,[1,0,0]))
    m.apply_translation([0,base_y,0])
    return mesh_color(m,color)

def put(name,meshes):
    combined=trimesh.util.concatenate(meshes)
    # GLB with vertex-color material and one reusable geometry
    scene=trimesh.Scene()
    scene.add_geometry(combined,geom_name=name,node_name=name)
    target=OUT/(name+'.glb')
    target.write_bytes(trimesh.exchange.gltf.export_glb(scene))
    # Verify the exported model can be parsed
    check=trimesh.load(target,force='scene')
    assert len(check.geometry)>0
    print(name, target.stat().st_size,'bytes',len(combined.faces),'triangles')

put('pine',[
    trunk(3.3,.15),
    upright_cone(2.1,1.2,1.15,(32,107,63,255)),
    upright_cone(2.0,1.0,2.05,(39,128,72,255)),
    upright_cone(1.75,.76,2.95,(65,154,77,255)),
])
put('oak',[
    trunk(3.0,.24),
    sphere((0,3.7,0),(1.58,1.48,1.44),(68,145,66,255),2),
    sphere((.77,3.38,.4),(.96,1.05,.92),(106,174,73,255),1),
    sphere((-.68,4.1,-.25),(.9,.93,.9),(87,167,69,255),1),
])
put('birch',[
    trunk(3.7,.17,(172,166,128,255)),
    sphere((0,4,0),(1.25,1.74,1.15),(132,186,73,255),2),
    sphere((.48,4.65,.12),(.7,.86,.8),(170,199,85,255),1),
])
put('shrub',[
    sphere((0,.6,0),(.81,.68,.81),(67,141,62,255),1),
    sphere((.42,.69,.23),(.58,.58,.55),(85,167,77,255),1),
    sphere((-.29,.78,-.23),(.54,.54,.56),(117,177,72,255),1)
])
put('rock',[
    sphere((0,.45,0),(1.0,.70,.86),(136,137,124,255),1),
    sphere((.43,.30,.4),(.48,.39,.44),(171,164,145,255),0)
])
put('reeds',[
    *[upright_cone(1.25+(.2 if i%3==0 else 0),.075,0,(65+6*i,126+3*i,67,255)) for i in range(7)]
])
put('flowers',[
    *[sphere((np.cos(i*2.399)*.39,.24+(.09 if i%3==0 else 0),np.sin(i*2.399)*.39),(.16,.16,.16),
       ((246,172,89,255) if i%3==0 else (230,158,190,255) if i%3==1 else (249,218,94,255)),0) for i in range(8)],
    sphere((0,.15,0),(.47,.22,.47),(73,155,69,255),1)
])
