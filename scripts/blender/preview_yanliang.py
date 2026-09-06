"""Render the actual rigged actions as numbered frames for an animated review."""
import bpy
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/yanliang'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'YanLiang.blend'))
scene=bpy.context.scene
rig=bpy.data.objects['YanLiang_Rig']
scene.render.engine='CYCLES'
scene.cycles.samples=8
scene.cycles.use_denoising=True
scene.render.resolution_x=480
scene.render.resolution_y=560
scene.render.resolution_percentage=100
camera=scene.camera
camera.location=(3.6,-6,3.2)
camera.rotation_euler=(Vector((-.12,-.15,1.25))-camera.location).to_track_quat('-Z','Y').to_euler()
for name, duration, count in [('walk',60,24),('attack',45,24)]:
    if '--attack-only' in sys.argv and name != 'attack':
        continue
    folder=OUT/name; folder.mkdir(exist_ok=True)
    rig.animation_data.action=bpy.data.actions[name]
    camera.data.ortho_scale=3.15 if name=='walk' else 4.3
    if name=='attack':
        camera.rotation_euler=(Vector((-.12,-.15,1.45))-camera.location).to_track_quat('-Z','Y').to_euler()
    for index in range(count):
        scene.frame_set(round(index/(count-1)*duration))
        scene.render.filepath=str(folder/f'{index:03}.png')
        bpy.ops.render.render(write_still=True)
        print(f'PREVIEW {name} {index+1}/{count}',flush=True)
