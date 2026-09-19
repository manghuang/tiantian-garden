"""Keep each FBX take paired with its facial action while Blender bakes it."""
import bpy

def export_paired_fbx(filepath,rig,shape_keys):
    original=shape_keys.animation_data.action
    def sync_face(scene,*unused):
        action=rig.animation_data.action
        face=bpy.data.actions.get(action.name+'_Face') if action else None
        if face and shape_keys.animation_data.action!=face:
            shape_keys.animation_data.action=face
    bpy.app.handlers.frame_change_pre.append(sync_face)
    try:
        sync_face(bpy.context.scene)
        bpy.ops.export_scene.fbx(filepath=str(filepath),use_selection=True,
            object_types={'ARMATURE','MESH'},add_leaf_bones=False,use_armature_deform_only=True,
            bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False,
            bake_anim_simplify_factor=0.0,path_mode='COPY',embed_textures=True,
            axis_forward='-Z',axis_up='Y')
    finally:
        bpy.app.handlers.frame_change_pre.remove(sync_face)
        shape_keys.animation_data.action=original
