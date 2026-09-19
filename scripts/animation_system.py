"""Eleven coordinated quadruped performances, with contact phases and facial beats."""
import bpy,math,json
from math import sin,cos,pi
from mathutils import Vector,Euler
from mouth_system import set_open

CATALOG=[
    ('Idle_Breathe',181,'放松待机',True),('Mouth_OpenClose',151,'自然张合',False),('Walk',49,'自然行走',True),
    ('Trot',31,'轻快小跑',True),('Happy_Tail',121,'开心摇尾',True),
    ('Curious_Look',151,'好奇张望',False),('Sniff',121,'探头嗅闻',False),
    ('Play_Bow',121,'邀请玩耍',False),('Wink',91,'俏皮眨眼',False),
    ('Hello_Wave',151,'抬爪招呼',False),('Takeoff_Hover',181,'展翼起飞',False)]

def smooth(v):
    v=max(0,min(1,v));return v*v*v*(v*(v*6-15)+10)
def pulse(t,start,end,ramp):return smooth((t-start)/ramp)*smooth((end-t)/ramp)
def blink_at(t,peak):
    d=t-peak
    if -.067<=d<0:return smooth(1+d/.067)
    if 0<=d<.15:return 1-smooth(d/.15)
    return 0
def curve_at(t,points):
    for (a,x),(b,y) in zip(points,points[1:]):
        if a<=t<=b:return x+(y-x)*smooth((t-a)/(b-a))
    return points[0][1] if t<points[0][0] else points[-1][1]

def build_animations(rig,lids,out):
    sk=lids.data.shape_keys;sk.animation_data_create();rig.animation_data_create()
    keys={k.name:k for k in sk.key_blocks if k.name!='Basis'}
    def orient(name,angles):
        pb=rig.pose.bones[name];rest=pb.bone.matrix_local.to_quaternion()
        pb.rotation_quaternion=rest.inverted()@Euler(angles,'XYZ').to_quaternion()@rest
    def move(name,v):
        pb=rig.pose.bones[name];pb.location=pb.bone.matrix_local.to_3x3().inverted()@Vector(v)
    def reset():
        for pb in rig.pose.bones:pb.location=(0,0,0);pb.rotation_quaternion=(1,0,0,0);pb.scale=(1,1,1)
        for key in keys.values():key.value=0
    def lids_pose(left=0,right=0,squint=(0,0),wide=(0,0)):
        for si,b,q,w in zip(['L','R'],[left,right],squint,wide):
            b=max(0,min(1,b));keys['Blink.'+si].value=b;keys['BlinkArc.'+si].value=4*b*(1-b)
            keys['Squint.'+si].value=q*(1-b);keys['Wide.'+si].value=w*(1-b)
    def face(t,smile=.30,mouth=.025,gaze=(0,0),brows=(0,0),squint=(0,0),wide=(0,0),blinks=()):
        bl=max([blink_at(t,p) for p in blinks]+[0]);br=max([blink_at(t,p+.004) for p in blinks]+[0])
        lids_pose(bl,br,squint,wide)
        set_open(rig,mouth)
        for s,si,b in zip([1,-1],['L','R'],brows):
            move('lip_corner.'+si,(s*.025*smile,0,.026*smile))
            move('brow.'+si,(0,0,.042*b));orient('brow.'+si,(0,s*.12*b,0))
            orient('eye.'+si,(gaze[1],0,gaze[0]))
    def wings(deploy=0,flutter=0):
        for s,si in [(1,'L'),(-1,'R')]:orient('wing.'+si,(0,s*flutter,s*math.radians(78)*(1-deploy)))
    def follow(p,amount=1):
        for s,si in [(1,'L'),(-1,'R')]:
            orient('ear_base.'+si,(.025*sin(p-.25)*amount,s*.022*sin(p-.2)*amount,0))
            orient('ear_mid.'+si,(.035*sin(p-.55)*amount,s*.045*sin(p-.55)*amount,0))
            orient('ear_tip.'+si,(.036*sin(p-.90)*amount,s*.070*sin(p-.9)*amount,0))
            orient('strap.'+si,(.027*sin(p-.55)*amount,s*.025*sin(p-.7)*amount,0))
    def tail(p,amp=.16):
        orient('tail_01',(.025*sin(p),0,amp*sin(p)))
        orient('tail_02',(.045*sin(p-.4),0,.7*amp*sin(p-.6)))
        orient('tail_03',(.060*sin(p-.8),0,.52*amp*sin(p-1.0)))
    def base(t,duration):
        p=2*pi*t/duration;wings()
        move('chest',(0,0,.006*sin(2*p)));orient('chest',(.010*sin(2*p),0,0))
        orient('neck',(-.014*sin(2*p),0,0));follow(p,.5)
    def footstep(u,stride,lift,duty):
        u%=1
        if u<duty:return (-stride/2+stride*u/duty,0,0)
        a=(u-duty)/(1-duty)
        return (stride/2-stride*smooth(a),lift*sin(pi*a)**1.4,-.27*sin(2*pi*a)*sin(pi*a))
    def perform(name,t,duration):
        base(t,duration);u=t/duration;p=2*pi*u
        if name=='Idle_Breathe':
            face(t,.24,.045*pulse(t,2.4,3.9,.55),(.025*sin(p),.01*sin(2*p)),(.08,.10),blinks=(1.5,4.7))
            orient('head',(.013*sin(p),.016*sin(p),.037*sin(p)));tail(2*p,.085)
        elif name=='Mouth_OpenClose':
            opening=curve_at(t,[(0,0),(.5,0),(1.15,.20),(1.65,.20),(2.3,.50),(2.75,.50),(3.35,.95),(3.7,.95),(4.65,0),(5,0)])
            face(t,.20+.30*opening,opening,(0,0),(.08,.10),blinks=(.7,4.65))
            tail(p,.045)
        elif name in ['Walk','Trot']:
            trot=name=='Trot';duty=.52 if trot else .67;stride=.37 if trot else .265;lift=.12 if trot else .085
            phases={('front','L'):0,('hind','R'):0 if trot else .25,('front','R'):.5,('hind','L'):.5 if trot else .75}
            move('pelvis',(.012*sin(p),0,(-.026+.019*cos(2*p)) if trot else .015*cos(2*p)))
            orient('spine',(.015*sin(2*p),0,.018*sin(p)));orient('chest',(-.018*sin(2*p),.012*sin(p),-.012*sin(p)))
            orient('head',(.016*sin(2*p),-.011*sin(p),-.018*sin(p)))
            for (limb,si),phase in phases.items():
                y,z,roll=footstep(u+phase,stride,lift,duty)
                move(f'CTRL_{limb}_foot.{si}',(0,y,z+.025*abs(roll)))
                orient(f'CTRL_{limb}_foot.{si}',(roll,0,0))
            face(t,.32,(.24+.08*sin(2*p)) if trot else 0,squint=(.08,.08),blinks=(duration*.73,))
            follow(2*p,1.5 if trot else .75);tail(p,.12)
        elif name=='Happy_Tail':
            e=.5+.5*sin(p)
            face(t,.78,.48+.08*sin(4*p),(.035*sin(p),-.015),(.18,.22),(.22,.25),blinks=(1.2,3.2))
            orient('head',(-.025,.055*sin(p),.050*sin(p)));move('chest',(.012*sin(p),0,.012*sin(2*p)))
            move('tongue',(0,-.021-.008*sin(4*p),0));follow(3*p,.9);tail(4*p,.34)
        elif name=='Curious_Look':
            yaw=curve_at(u,[(0,0),(.2,.27),(.38,.27),(.62,-.27),(.81,-.16),(1,0)])
            tilt=curve_at(u,[(0,0),(.22,-.11),(.40,-.11),(.66,.115),(.83,.08),(1,0)])
            orient('head',(.025,tilt,yaw));orient('neck',(.01,0,yaw*.20))
            face(t,.24,.03*pulse(t,.6,2.3,.5),(yaw*.18,-.015),(.75*max(0,yaw/.27),.75*max(0,-yaw/.27)),wide=(.15,.15),blinks=(.75,2.6,4.6))
            follow(1.5*p,.75);tail(p,.055)
        elif name=='Sniff':
            e=pulse(t,.15,3.9,.75);sn=sin(t*2*pi*3)*e
            orient('neck',(.14*e,0,.05*sin(p)*e));orient('head',(.18*e+.012*sn,.035*sin(2*p)*e,.05*sin(p)*e))
            move('chest',(0,-.025*e,-.035*e));face(t,.10,0,(.018*sin(p),.055*e),(-.10,-.10),(.20*e,.16*e),blinks=(.33,3.55))
            follow(2*p,.65);tail(p,.07)
        elif name=='Play_Bow':
            e=pulse(t,.15,3.85,.8)
            move('chest',(0,-.065*e,-.115*e));orient('spine',(.11*e,0,0));orient('neck',(-.08*e,0,0));orient('head',(-.065*e,.025*sin(2*p)*e,0))
            for si in ['L','R']:move('CTRL_front_foot.'+si,(0,-.125*e,0))
            face(t,.80,.42*e,(0,-.02),(.24,.24),(.18*e,.18*e),blinks=(1.4,3.4))
            follow(3*p,1.1*e);tail(4*p,.16+.19*e)
        elif name=='Wink':
            e=pulse(t,.3,2.7,.55);wink=pulse(t,1.08,1.82,.17)
            orient('head',(-.025*e,-.105*e,.055*e))
            face(t,.35+.50*e,.10*e,(.025,0),(.45*e,.16*e),(.12*e,.06*e),blinks=(2.65,))
            if wink>0:lids_pose(wink,0,(.12*e,.07*e),(0,.08*e))
            follow(p,.55);tail(2*p,.18)
        elif name=='Hello_Wave':
            e=pulse(t,.2,4.8,.85);lift=pulse(t,.55,4.45,.85);wave=sin(t*2*pi*1.5)*pulse(t,1.55,3.7,.35)
            move('chest',(-.050*lift,0,0));move('pelvis',(-.017*lift,0,0))
            move('CTRL_front_foot.L',(.035*lift+.040*wave,-.115*lift,.34*lift+.026*wave))
            orient('CTRL_front_foot.L',(.20*lift,0,.10*wave))
            orient('head',(-.033*e,.06*e,.055*e))
            face(t,.35+.42*e,.36*e,(.018,-.015),(.25*e,.30*e),(.13*e,.16*e),blinks=(1.2,3.7))
            follow(2*p,.80);tail(4*p,.17+.13*e)
        elif name=='Takeoff_Hover':
            deploy=pulse(t,0,6,.85);air=pulse(t,.85,5.25,.85)
            wings(deploy,.023*sin(4*p)*air)
            move('root',(0,0,.49*air+.019*sin(4*p)*air));orient('head',(-.075*air,.025*sin(p)*air,0))
            for limb in ['front','hind']:
                for si in ['L','R']:
                    move(f'CTRL_{limb}_foot.{si}',(0,.065*air,.095*air));orient(f'CTRL_{limb}_foot.{si}',(.10*air,0,0))
            face(t,.47,.18*air,(.01,-.035*air),(.18,.20),wide=(.1*air,.1*air),blinks=(2.0,4.45))
            follow(4*p,1.6*air+.4);tail(2*p,.13)
    actions=[];catalog=[]
    for name,frames,label,loop in CATALOG:
        rig.animation_data.action=None;sk.animation_data.action=None
        action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
        duration=(frames-1)/30
        for frame in range(1,frames+1):
            reset();perform(name,(frame-1)/30,duration)
            for pb in rig.pose.bones:
                if '_pole.' in pb.name:continue
                pb.keyframe_insert('location',frame=frame,group=pb.name);pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
            for k in keys.values():k.keyframe_insert('value',frame=frame)
        facial=sk.animation_data.action;facial.name=name+'_Face';facial.use_fake_user=True
        for a in [action,facial]:
            for fc in a.fcurves:
                for kf in fc.keyframe_points:kf.interpolation='LINEAR'
        rig.animation_data.action=None;sk.animation_data.action=None
        for ad,a in [(rig.animation_data,action),(sk.animation_data,facial)]:
            tr=ad.nla_tracks.new();tr.name=name;st=tr.strips.new(name,1,a);st.extrapolation='NOTHING';tr.mute=True
        action['description']=label;action['loop']=loop
        actions.append(action);catalog.append({'name':name,'label_zh':label,'frames':frames,'duration_seconds':duration,'fps':30,'loop':loop})
    reset();rig.animation_data.action=actions[0];sk.animation_data.action=bpy.data.actions['Idle_Breathe_Face']
    (out/'animation_catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
    return actions,sk
