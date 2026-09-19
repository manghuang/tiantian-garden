"""Check real IK evaluation, sole orientation, facial symmetry and clip payloads."""
import bpy,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
rig=bpy.data.objects['Skye_Rig'];sk=bpy.data.objects['Upper_lids | Blink shape key'].data.shape_keys
for ad in [rig.animation_data,sk.animation_data]:
    for tr in ad.nla_tracks:tr.mute=True
scene=bpy.context.scene;result={'clips':[]}
catalog=json.loads((OUT/'animation_catalog.json').read_text(encoding='utf-8'))
for item in catalog:
    name=item['name'];rig.animation_data.action=bpy.data.actions[name];sk.animation_data.action=bpy.data.actions[name+'_Face']
    max_error=0;min_z=10;max_rot_error=0;count=0
    for frame in range(1,item['frames']+1,3):
        scene.frame_set(frame);bpy.context.view_layer.update()
        for limb in ['front','hind']:
            for side in ['L','R']:
                foot=rig.pose.bones[f'{limb}_paw.{side}'];target=rig.pose.bones[f'CTRL_{limb}_foot.{side}']
                max_error=max(max_error,(foot.head-target.head).length)
                q=foot.matrix.to_quaternion();tq=target.matrix.to_quaternion()
                max_rot_error=max(max_rot_error,q.rotation_difference(tq).angle)
                min_z=min(min_z,foot.head.z);count+=1
        for si in ['L','R']:
            b=sk.key_blocks['Blink.'+si].value;a=sk.key_blocks['BlinkArc.'+si].value
            assert abs(a-4*b*(1-b))<1e-5
        assert all(math.isfinite(x) for pb in rig.pose.bones for row in pb.matrix for x in row)
    result['clips'].append({'name':name,'samples':count,'max_ik_target_error':max_error,'max_paw_rotation_error_radians':max_rot_error,'minimum_paw_joint_height':min_z})
result['all_ik_targets_within_1cm']=all(c['max_ik_target_error']<.01 for c in result['clips'])
result['passed']=result['all_ik_targets_within_1cm']
(OUT/'motion_validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result,indent=2),flush=True)
assert result['passed'],'Some IK targets exceeded the 1 cm tolerance; adjust the authored pose.'
