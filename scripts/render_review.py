"""Render views and representative deformation poses from the native file."""
import bpy,sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
scene=bpy.context.scene;rig=bpy.data.objects['Skye_Rig']
scene.render.resolution_x=680;scene.render.resolution_y=800
scene.render.resolution_percentage=100;scene.cycles.samples=20
sk=bpy.data.objects['Upper_lids | Blink shape key'].data.shape_keys
def pose(action,frame):
    for tr in rig.animation_data.nla_tracks:tr.mute=True
    for tr in sk.animation_data.nla_tracks:tr.mute=True
    rig.animation_data.action=bpy.data.actions[action]
    sk.animation_data.action=bpy.data.actions[action+'_Blink']
    scene.frame_set(frame)
    bpy.context.view_layer.update()
def render(name,camera,action='Idle_Breathe',frame=1):
    pose(action,frame);scene.camera=bpy.data.objects[camera]
    saved=scene.camera.data.ortho_scale
    if action=='Takeoff_Hover':scene.camera.data.ortho_scale=4.65
    scene.render.filepath=str(OUT/name);bpy.ops.render.render(write_still=True)
    scene.camera.data.ortho_scale=saved
samples=[('Skye_Front.png','Camera | front','Idle_Breathe',1),('Skye_Side.png','Camera | side','Idle_Breathe',1),('Skye_Back.png','Camera | back','Idle_Breathe',1),('Skye_Walk.png','Camera | hero','Walk',12),('Skye_Flight.png','Camera | hero','Takeoff_Hover',76),('Skye_Blink.png','Camera | front','Idle_Breathe',52)]
for a in samples:render(*a)
print('REVIEW_RENDER_COMPLETE',flush=True)
