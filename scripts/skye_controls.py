"""Run once in Blender, or use Open_Skye.cmd, for the Skye animation sidebar."""
import bpy
from mathutils import Euler

LABELS=[('Idle_Breathe','放松待机'),('Mouth_OpenClose','自然张合'),('Walk','自然行走'),('Trot','轻快小跑'),('Happy_Tail','开心摇尾'),('Curious_Look','好奇张望'),('Sniff','探头嗅闻'),('Play_Bow','邀请玩耍'),('Wink','俏皮眨眼'),('Hello_Wave','抬爪招呼'),('Takeoff_Hover','展翼起飞')]
def assets():
    rig=bpy.data.objects.get('Skye_Rig');lids=bpy.data.objects.get('Upper_lids | Blink shape key')
    return rig,lids.data.shape_keys if lids else None
def stop_faces(sk):
    if sk.animation_data:
        sk.animation_data.action=None
        for tr in sk.animation_data.nla_tracks:tr.mute=True

class SKYE_OT_clip(bpy.types.Operator):
    bl_idname='skye.clip';bl_label='播放动作';bl_options={'REGISTER','UNDO'}
    clip:bpy.props.StringProperty()
    def execute(self,context):
        rig,sk=assets()
        if not rig or self.clip not in bpy.data.actions:return {'CANCELLED'}
        for ad in [rig.animation_data,sk.animation_data]:
            for tr in ad.nla_tracks:tr.mute=True
        rig.animation_data.action=bpy.data.actions[self.clip]
        sk.animation_data.action=bpy.data.actions[self.clip+'_Face']
        context.scene.frame_start=1;context.scene.frame_end=int(rig.animation_data.action.frame_range[1]);context.scene.frame_set(1)
        return {'FINISHED'}

class SKYE_OT_face(bpy.types.Operator):
    bl_idname='skye.face';bl_label='查看表情';bl_options={'REGISTER','UNDO'}
    preset:bpy.props.StringProperty()
    def execute(self,context):
        rig,sk=assets()
        if not rig:return {'CANCELLED'}
        selframe={'relaxed':('Idle_Breathe',1),'smile':('Happy_Tail',31),'curious':('Curious_Look',43),'wink':('Wink',44),'hello':('Hello_Wave',69),'blink':('Idle_Breathe',46)}
        clip,frame=selframe[self.preset]
        bpy.ops.skye.clip(clip=clip);context.scene.frame_set(frame)
        return {'FINISHED'}

def blink_get(si):
    def get(self):
        _,sk=assets();return sk.key_blocks['Blink.'+si].value if sk else 0
    return get
def blink_set(si):
    def set(self,v):
        _,sk=assets()
        if not sk:return
        stop_faces(sk)
        sk.key_blocks['Squint.'+si].value=0;sk.key_blocks['Wide.'+si].value=0
        sk.key_blocks['Blink.'+si].value=v;sk.key_blocks['BlinkArc.'+si].value=4*v*(1-v)
    return set

def mouth_get(self):
    rig,_=assets()
    if not rig:return 0
    pb=rig.pose.bones['jaw'];rest=pb.bone.matrix_local.to_quaternion()
    angle=(rest@pb.rotation_quaternion@rest.inverted()).to_euler('XYZ').x
    return max(0,min(1,angle/rig.get('Jaw_open_max_radians',.46)))

def mouth_set(self,value):
    rig,_=assets()
    if not rig:return
    rig.animation_data.action=None
    for tr in rig.animation_data.nla_tracks:tr.mute=True
    pb=rig.pose.bones['jaw'];rest=pb.bone.matrix_local.to_quaternion()
    pb.rotation_quaternion=rest.inverted()@Euler((value*rig.get('Jaw_open_max_radians',.46),0,0),'XYZ').to_quaternion()@rest
    rig.pose.bones['tongue'].location=(0,0,0)

class SKYE_OT_mouth(bpy.types.Operator):
    bl_idname='skye.mouth';bl_label='调整嘴巴';bl_options={'REGISTER','UNDO'}
    amount:bpy.props.FloatProperty(min=0,max=1)
    def execute(self,context):
        context.scene.skye_mouth_open=self.amount;context.view_layer.update()
        return {'FINISHED'}

class SKYE_PT_controls(bpy.types.Panel):
    bl_label='天天 · 动作与表情';bl_idname='SKYE_PT_controls';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='Skye / 天天'
    @classmethod
    def poll(cls,context):return bpy.data.objects.get('Skye_Rig') is not None
    def draw(self,context):
        layout=self.layout;rig,sk=assets()
        layout.label(text='选择动作后，按空格播放')
        grid=layout.grid_flow(columns=2,align=True)
        for name,label in LABELS:
            op=grid.operator('skye.clip',text=label);op.clip=name
        layout.separator();layout.label(text='表情预设')
        grid=layout.grid_flow(columns=3,align=True)
        for name,label in [('relaxed','放松'),('smile','开心'),('curious','好奇'),('wink','眨单眼'),('hello','招呼'),('blink','闭眼')]:
            op=grid.operator('skye.face',text=label);op.preset=name
        layout.separator();layout.label(text='嘴巴张合')
        row=layout.row(align=True)
        for label,value in [('闭合',0),('微张',.25),('张开',.85)]:
            row.operator('skye.mouth',text=label).amount=value
        layout.prop(context.scene,'skye_mouth_open',slider=True)
        layout.label(text='手动调节后，重新选择动作可恢复播放')
        layout.separator();layout.label(text='手动眼睑（自动弧线修正）')
        layout.prop(context.scene,'skye_blink_l',slider=True);layout.prop(context.scene,'skye_blink_r',slider=True)
        layout.label(text='其它表情控制：眉毛、嘴角、下颌、眼球骨')
        layout.label(text='绿色足部骨为 IK 目标')

def register():
    for cls in [SKYE_OT_clip,SKYE_OT_face,SKYE_OT_mouth,SKYE_PT_controls]:
        old=getattr(bpy.types,cls.__name__,None)
        if old:
            try:bpy.utils.unregister_class(old)
            except RuntimeError:pass
        bpy.utils.register_class(cls)
    bpy.types.Scene.skye_blink_l=bpy.props.FloatProperty(name='左眼闭合',min=0,max=1,get=blink_get('L'),set=blink_set('L'))
    bpy.types.Scene.skye_blink_r=bpy.props.FloatProperty(name='右眼闭合',min=0,max=1,get=blink_get('R'),set=blink_set('R'))
    bpy.types.Scene.skye_mouth_open=bpy.props.FloatProperty(name='张嘴幅度',min=0,max=1,get=mouth_get,set=mouth_set)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.show_region_ui=True
register()
