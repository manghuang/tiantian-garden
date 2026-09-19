"""Render a labelled showcase of all eleven performances at their authored speed."""
import bpy, math, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
sys.path.insert(0,str(ROOT/'scripts'))
from render_device import configure
scene=bpy.context.scene;rig=bpy.data.objects['Skye_Rig']
sk=bpy.data.objects['Upper_lids | Blink shape key'].data.shape_keys
for ad in [rig.animation_data,sk.animation_data]:
    for tr in ad.nla_tracks:tr.mute=True
W,H,FPS=640,768,24
scene.render.resolution_x=W;scene.render.resolution_y=H;scene.render.resolution_percentage=100
scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.use_persistent_data=True
if configure(scene)=='OPTIX':scene.cycles.denoiser='OPTIX'
scene.render.image_settings.file_format='PNG'
frames=OUT/'frames';frames.mkdir(exist_ok=True)
catalog={x['name']:x for x in json.loads((OUT/'animation_catalog.json').read_text(encoding='utf-8'))}
# Source start in seconds, duration, camera. Repeated gaits wrap at their loop boundary.
segments=[('Mouth_OpenClose',0,5,'face'),('Idle_Breathe',1,1.5,'face'),('Walk',0,3.2,'hero'),('Trot',0,2,'hero'),
          ('Happy_Tail',.4,2,'face'),('Curious_Look',.2,3.4,'face'),('Sniff',.6,1.5,'hero'),
          ('Play_Bow',0,4,'hero'),('Wink',.5,1.6,'face'),('Hello_Wave',1.1,2.2,'hero'),
          ('Takeoff_Hover',0,6,'hero')]
idx=0;manifest=[]
for name,start,duration,camera in segments:
    rig.animation_data.action=bpy.data.actions[name];sk.animation_data.action=bpy.data.actions[name+'_Face']
    scene.camera=bpy.data.objects['Camera | '+camera]
    scene.camera.data.ortho_scale=1.94 if camera=='face' else 4.65 if name=='Takeoff_Hover' else 3.96
    count=round(duration*FPS)
    manifest.append({'name':name,'label_zh':catalog[name]['label_zh'],'first_image':idx,'image_count':count,'preview_fps':FPS,'source_start_seconds':start,'authored_speed':True})
    for j in range(count):
        t=start+j/FPS
        if catalog[name]['loop']:t%=catalog[name]['duration_seconds']
        f=1+t*30;scene.frame_set(int(f),subframe=f-int(f))
        scene.render.filepath=str(frames/f'{idx:04d}.png')
        if '--encode-only' not in sys.argv:bpy.ops.render.render(write_still=True)
        idx+=1
    print('PREVIEW_SEGMENT_COMPLETE',name,idx,flush=True)
(OUT/'preview_segments.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
assert all((frames/f'{i:04d}.png').exists() for i in range(idx))
bpy.ops.scene.new(type='NEW');edit=bpy.context.scene;edit.name='Skye animation showcase'
edit.render.resolution_x=W;edit.render.resolution_y=H;edit.render.resolution_percentage=100
edit.render.fps=FPS;edit.frame_start=1;edit.frame_end=idx
seq=edit.sequence_editor_create()
strip=seq.strips.new_image('Skye rendered actions',str(frames/'0000.png'),channel=1,frame_start=1)
for i in range(1,idx):strip.elements.append(f'{i:04d}.png')
strip.frame_final_duration=idx
font_path=Path('C:/Windows/Fonts/msyh.ttc')
font=bpy.data.fonts.load(str(font_path)) if font_path.exists() else None
for item in manifest:
    first=item['first_image']+1
    title=seq.strips.new_effect(item['name'],type='TEXT',channel=2,frame_start=first,frame_end=first+item['image_count'])
    title.text=item['label_zh']+' / '+item['name'].replace('_',' ') if font else item['name'].replace('_',' ')
    if font:title.font=font
    title.font_size=26;title.location=(.5,.95);title.color=(1,.97,.94,1)
    title.use_shadow=True;title.shadow_color=(.02,.025,.03,1)
edit.render.image_settings.file_format='FFMPEG';edit.render.ffmpeg.format='MPEG4';edit.render.ffmpeg.codec='H264'
edit.render.ffmpeg.constant_rate_factor='HIGH';edit.render.ffmpeg.ffmpeg_preset='GOOD'
edit.render.filepath=str(OUT/'Skye_Animation_Demo.mp4');edit.view_settings.view_transform='Standard'
bpy.ops.render.render(animation=True)
print('ANIMATION_DEMO_COMPLETE',idx,flush=True)
edit.frame_start=1;edit.frame_end=5*FPS
edit.render.filepath=str(OUT/'Skye_Mouth_Demo.mp4')
bpy.ops.render.render(animation=True)
print('MOUTH_DEMO_COMPLETE',5*FPS,flush=True)
