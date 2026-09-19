"""Independent FBX import, Blender sidebar smoke check, or MP4 decode check.

Run Blender with --factory-startup --python scripts/validate_delivery.py -- fbx|ui|video.
"""
import bpy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
mode=sys.argv[sys.argv.index('--')+1]
catalog=json.loads((OUT/'animation_catalog.json').read_text(encoding='utf-8'))
if mode=='fbx':
    bpy.ops.import_scene.fbx(filepath=str(OUT/'Skye_Animated.fbx'))
    rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
    actions=[a.name for a in bpy.data.actions]
    result={'armatures':len(rigs),'bones':[len(r.data.bones) for r in rigs],'animation_actions':actions}
    assert len(rigs)==1 and len(rigs[0].data.bones)==40
    assert all(any(c['name'] in a for a in actions) for c in catalog)
    facial=[]
    for item in catalog:
        matching=[a for a in bpy.data.actions if a.name.endswith('|'+item['name'])]
        varied=any('key_blocks[' in fc.data_path and max(k.co.y for k in fc.keyframe_points)-min(k.co.y for k in fc.keyframe_points)>.05 for a in matching for fc in a.fcurves if fc.keyframe_points)
        facial.append({'name':item['name'],'changing_facial_curves':varied})
    result['facial_animation']=facial
    assert all(x['changing_facial_curves'] for x in facial)
elif mode=='ui':
    bpy.ops.wm.open_mainfile(filepath=str(OUT/'Skye_Rigged.blend'))
    sys.path.insert(0,str(ROOT/'scripts'));import skye_controls
    rig,sk=skye_controls.assets()
    for clip in catalog:
        assert bpy.ops.skye.clip(clip=clip['name'])=={'FINISHED'}
        assert rig.animation_data.action.name==clip['name']
        assert sk.animation_data.action.name==clip['name']+'_Face'
        assert bpy.context.scene.frame_end==clip['frames']
    for preset in ['relaxed','smile','curious','wink','hello','blink']:
        assert bpy.ops.skye.face(preset=preset)=={'FINISHED'}
    bpy.context.scene.skye_blink_l=.5;bpy.context.scene.skye_blink_r=.8
    assert abs(sk.key_blocks['BlinkArc.L'].value-1)<1e-6
    assert abs(sk.key_blocks['BlinkArc.R'].value-.64)<1e-6
    bpy.ops.skye.face(preset='curious');bpy.context.scene.skye_blink_l=1
    assert sk.key_blocks['Wide.L'].value==0 and sk.key_blocks['Squint.L'].value==0
    for opening in [0,.25,.85,1,0]:
        assert bpy.ops.skye.mouth(amount=opening)=={'FINISHED'}
        assert abs(bpy.context.scene.skye_mouth_open-opening)<1e-5
        assert rig.animation_data.action is None
    result={'clips':len(catalog),'presets':6,'independent_blink_controls':True,'corrective_synchronized':True,'mouth_slider_and_presets':True}
elif mode=='video':
    scene=bpy.context.scene;seq=scene.sequence_editor_create()
    movie=seq.strips.new_movie('Actual delivery MP4',str(OUT/'Skye_Animation_Demo.mp4'),channel=1,frame_start=1)
    manifest=json.loads((OUT/'preview_segments.json').read_text(encoding='utf-8'))
    count=sum(i['image_count'] for i in manifest)
    width=movie.elements[0].orig_width;height=movie.elements[0].orig_height
    assert movie.frame_duration==count and width==640 and height==768
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='Standard';scene.render.image_settings.file_format='PNG'
    sample=next(x for x in manifest if x['name']=='Wink')['first_image']+24
    scene.frame_set(sample);scene.render.filepath=str(OUT/'video_check.png');bpy.ops.render.render(write_still=True)
    result={'frames':count,'width':width,'height':height,'fps':24,'duration_seconds':count/24,'clips':len(manifest),'decoded_sample_frame':sample}
    mouth=seq.strips.new_movie('Actual mouth demo',str(OUT/'Skye_Mouth_Demo.mp4'),channel=3,frame_start=1)
    assert mouth.frame_duration==120 and mouth.elements[0].orig_width==640 and mouth.elements[0].orig_height==768
    mouth_review=ROOT/'.tools'/'video-review';mouth_review.mkdir(parents=True,exist_ok=True)
    for sample in [1,84,120]:
        scene.frame_set(sample);scene.render.filepath=str(mouth_review/f'mouth_{sample:03d}.png')
        bpy.ops.render.render(write_still=True)
    result['mouth_demo']={'frames':120,'fps':24,'duration_seconds':5,'decoded_sample_frames':[1,84,120],'passed':True}
else:raise ValueError(mode)
result['passed']=True
(OUT/(mode+'_validation.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False),flush=True)
