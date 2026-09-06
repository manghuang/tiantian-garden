"""Reimport the standalone GLB, inspect animation and render its real contents."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(OUT/'Skye_Animated.glb'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
print('IMPORTED_ACTIONS',[(a.name,[s.identifier for s in a.slots]) for a in bpy.data.actions],flush=True)
print('IMPORTED_RIG',len(rig.data.bones),flush=True)
for o in bpy.context.scene.objects:
    ads=[o.animation_data]
    if o.type=='MESH' and o.data.shape_keys:ads.append(o.data.shape_keys.animation_data)
    for ad in ads:
        if not ad:continue
        ad.action=None
        for tr in ad.nla_tracks:tr.mute=tr.name!='Idle_Breathe'
with bpy.data.libraries.load(str(OUT/'Skye_Rigged.blend'),link=False) as (source,dest):
    dest.collections=['STUDIO | Render only'];dest.worlds=['Soft blue studio']
for c in dest.collections:bpy.context.scene.collection.children.link(c)
scene=bpy.context.scene;scene.world=dest.worlds[0];scene.camera=bpy.data.objects['Camera | hero']
scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
scene.render.resolution_x=680;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.15
scene.frame_set(1)
stats={'imported_bones':len(rig.data.bones),'skinned_meshes':sum(1 for o in scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)),'actions':[a.name for a in bpy.data.actions]}
assert stats['imported_bones']==33
assert stats['skinned_meshes']>100
assert all(any(label in a for a in stats['actions']) for label in ['Idle_Breathe','Walk','Happy_Tail','Takeoff_Hover'])
(OUT/'roundtrip_validation.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
scene.render.filepath=str(OUT/'Skye_GLB_Verified.png');bpy.ops.render.render(write_still=True)
print('ROUNDTRIP_COMPLETE',flush=True)
