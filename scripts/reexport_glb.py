import bpy,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from gltf_tools import root_skinned_meshes
rig=bpy.data.objects['Skye_Rig'];sk=bpy.data.objects['Upper_lids | Blink shape key'].data.shape_keys
rig.animation_data.action=None;sk.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=False
for tr in sk.animation_data.nla_tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for name in ['SKYE | Character meshes','SKYE | Groom · skinned strand meshes']:
    for o in bpy.data.collections[name].objects:o.select_set(True)
bpy.context.view_layer.objects.active=rig
dest=ROOT/'output'/'Skye_Animated.glb'
bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_anim_slide_to_zero=True,export_def_bones=True,export_force_sampling=True,export_tangents=True,export_morph=True,export_morph_animation=True,export_materials='EXPORT',export_extras=True)
root_skinned_meshes(dest)
print('GLB_EXPORT_COMPLETE',flush=True)
