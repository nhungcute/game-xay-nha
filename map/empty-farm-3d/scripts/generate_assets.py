"""Create original, lightweight CC0-style (public-domain-dedicated) GLB nature meshes.
    Requires trimesh + numpy; files are included with the project, no runtime Python needed.
"""
from pathlib import Path
import math
import numpy as np
import trimesh

DIR = Path(__file__).resolve().parents[1] / 'public/assets/models'
DIR.mkdir(parents=True, exist_ok=True)

def material(mesh, rgb, roughness=0.89):
    mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        name='Natural_' + ''.join(str(v) for v in rgb[:3]),
        baseColorFactor=list(rgb[:3])+[255],
        metallicFactor=0, roughnessFactor=roughness, doubleSided=True))
    return mesh

def cone(radius, height, y, color, x=0, z=0, sections=9):
    m=trimesh.creation.cone(radius=radius,height=height,sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(-math.pi/2, [1,0,0]))
    m.apply_translation([x,y+height/2,z])
    return material(m,color)

def trunk(radius,height,color,y=0):
    m=trimesh.creation.cylinder(radius,height,sections=8)
    m.apply_transform(trimesh.transformations.rotation_matrix(-math.pi/2,[1,0,0]))
    m.apply_translation([0,y+height/2,0])
    return material(m,color)

def ico(pos,scale,color,sub=1):
    m=trimesh.creation.icosphere(subdivisions=sub,radius=1)
    m.apply_scale(scale)
    m.apply_translation(pos)
    return material(m,color)

def write(name, meshes):
    scene=trimesh.Scene()
    for i,m in enumerate(meshes):
        scene.add_geometry(m,node_name=f'{name}_part_{i}',geom_name=f'{name}_mesh_{i}')
    out=DIR/(name+'.glb')
    out.write_bytes(scene.export(file_type='glb'))
    print(out.name,out.stat().st_size,'bytes')

write('pine', [trunk(.21,3.8,(99,75,48)),cone(2.0,3.6,1.5,(32,94,49)),cone(1.74,3.3,3.0,(33,112,51)),cone(1.25,3.0,4.7,(51,138,66)),cone(.65,1.7,6.3,(68,156,73))])
write('oak', [trunk(.37,4.0,(116,80,49)),ico((-.75,4.7,0),(2.3,2.1,2.1),(70,147,55)),ico((1.15,5.0,.3),(2.4,2.2,2.2),(62,150,58)),ico((0,6.1,-.3),(2.55,2.2,2.4),(89,167,59)),ico((.2,6.0,1.2),(2.05,1.7,1.8),(111,179,75))])
write('shrub',[ico((-.48,.7,.05),(.85,.73,.7),(64,128,43)),ico((.38,.82,0),(.89,.91,.71),(90,153,51)),ico((.03,1.12,-.28),(.65,.71,.6),(119,174,65))])
write('rock',[ico((0,.53,0),(1.24,.68,.98),(141,143,132)),ico((.55,.25,.42),(.58,.38,.51),(112,119,111))])
write('rock_warm',[ico((0,.56,0),(1.20,.74,1.05),(170,160,133)),ico((-.53,.23,.25),(.54,.32,.57),(129,128,115))])
write('flower',[trunk(.035,.54,(66,131,46)),ico((0,.63,0),(.15,.13,.15),(246,165,98),sub=0),ico((-.08,.60,-.04),(.11,.12,.11),(255,216,103),sub=0)])
