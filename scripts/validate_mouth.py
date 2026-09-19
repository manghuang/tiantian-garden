"""Check actual deformed lip surfaces, closed-mouth occlusion and the exported take."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from mouth_system import set_open,seam_z
OUT=ROOT/'output';scene=bpy.context.scene;rig=bpy.data.objects['Skye_Rig']
for ad in [rig.animation_data,bpy.data.objects['Upper_lids | Blink shape key'].data.shape_keys.animation_data]:
    ad.action=None
    for track in ad.nla_tracks:track.mute=True
for pb in rig.pose.bones:
    pb.location=(0,0,0);pb.rotation_quaternion=(1,0,0,0);pb.scale=(1,1,1)
upper=bpy.data.objects['Mouth | upper lip seal'];lower=bpy.data.objects['Mouth | lower lip seal']
def points(obj,dg):
    evaluated=obj.evaluated_get(dg)
    return [evaluated.matrix_world@evaluated.data.vertices[i].co for i in obj['seal_indices']]
results=[]
for value in [0,.15,.35,.65,1,0]:
    set_open(rig,value);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    up=points(upper,dg);lo=points(lower,dg);mid=len(up)//2
    gap=sum(up[i].z-lo[i].z for i in range(mid-3,mid+4))/7
    interior=0;hits=[]
    for x in [-.16,-.08,0,.08,.16]:
        i=min(range(len(up)),key=lambda i:abs(up[i].x-x))
        z=(up[i].z+lo[i].z)/2
        hit,position,normal,index,obj,matrix=scene.ray_cast(dg,Vector((x,-2.8,z)),Vector((0,1,0)))
        name=obj.name if hit else None;hits.append(name)
        if hit and obj.get('Mouth_part')=='interior':interior+=1
    results.append({'opening':value,'measured_central_lip_gap':gap,'visible_interior_rays':interior,'hit_objects':hits})
    assert all(math.isfinite(v) for p in up+lo for v in p)
assert results[0]['measured_central_lip_gap']<.001
assert results[-1]['measured_central_lip_gap']<.001
assert results[0]['visible_interior_rays']==0 and results[-1]['visible_interior_rays']==0
assert all(b['measured_central_lip_gap']>a['measured_central_lip_gap'] for a,b in zip(results[:4],results[1:5]))
assert results[4]['measured_central_lip_gap']>.14
assert results[4]['visible_interior_rays']>=3
assert 'Mouth_OpenClose' in bpy.data.actions
report={'passed':True,'poses':results,'closed_lips_seal':True,'open_close_cycle_returns_to_seal':True}
(OUT/'mouth_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
