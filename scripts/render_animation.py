"""Render all four delivered clips to a small, easy-to-preview MP4."""
import bpy, math, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
scene=bpy.context.scene;rig=bpy.data.objects['Skye_Rig']
sk=bpy.data.objects['Upper_lids | Blink shape key'].data.shape_keys
for tr in rig.animation_data.nla_tracks:tr.mute=True
for tr in sk.animation_data.nla_tracks:tr.mute=True
scene.camera=bpy.data.objects['Camera | hero'];scene.camera.data.ortho_scale=4.55
scene.render.resolution_x=560;scene.render.resolution_y=680;scene.render.resolution_percentage=100
scene.cycles.samples=12;scene.cycles.use_denoising=True
frames=OUT/'frames';frames.mkdir(exist_ok=True)
segments=[('Idle_Breathe',25,0,120),('Walk',25,0,80),('Happy_Tail',31,0,90),('Takeoff_Hover',51,0,150)]
idx=0;manifest=[]
for name,count,start,end in segments:
    rig.animation_data.action=bpy.data.actions[name];sk.animation_data.action=bpy.data.actions[name+'_Blink']
    manifest.append({'name':name,'first_image':idx,'image_count':count,'preview_fps':12})
    for j in range(count):
        f=start+(end-start)*j/(count-1)
        if name=='Walk':f%=40
        scene.frame_set(int(f)+1,subframe=f-int(f))
        scene.render.filepath=str(frames/f'{idx:04d}.png')
        bpy.ops.render.render(write_still=True);idx+=1
    print('PREVIEW_SEGMENT_COMPLETE',name,idx,flush=True)
(OUT/'preview_segments.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
# Encode the actual rendered frames using Blender's bundled FFmpeg writer.
bpy.ops.scene.new(type='NEW');edit=bpy.context.scene;edit.name='Animation preview edit'
edit.render.resolution_x=560;edit.render.resolution_y=680;edit.render.resolution_percentage=100
edit.render.fps=12;edit.frame_start=1;edit.frame_end=idx
seq=edit.sequence_editor_create()
strip=seq.sequences.new_image('Skye rendered actions',str(frames/'0000.png'),channel=1,frame_start=1)
for i in range(1,idx):strip.elements.append(f'{i:04d}.png')
strip.frame_final_duration=idx
edit.render.image_settings.file_format='FFMPEG';edit.render.ffmpeg.format='MPEG4';edit.render.ffmpeg.codec='H264'
edit.render.ffmpeg.constant_rate_factor='HIGH';edit.render.ffmpeg.ffmpeg_preset='GOOD'
edit.render.filepath=str(OUT/'Skye_Animation_Demo.mp4');edit.view_settings.view_transform='Standard'
bpy.ops.render.render(animation=True)
print('ANIMATION_DEMO_COMPLETE',flush=True)
