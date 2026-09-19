"""Rebuild the reference-based Skye character in Blender 4.5 LTS.

Run: blender -b --factory-startup --python scripts/build_skye.py
All meshes, materials, rig weights and animation are authored here. No imported model.
"""
import bpy, math, random, json, os, sys, time
import numpy as np
from pathlib import Path
from mathutils import Vector, Quaternion
from math import sin, cos, pi, sqrt, exp

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
OUT = ROOT / 'output'
TEX = OUT / 'textures'
OUT.mkdir(exist_ok=True); TEX.mkdir(exist_ok=True)
random.seed(417)
rng = np.random.default_rng(417)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200; scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.fps = 30
scene.unit_settings.system = 'METRIC'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = 0.15

def collection(name):
    c = bpy.data.collections.new(name); scene.collection.children.link(c); return c
CHAR = collection('SKYE | Character meshes')
FUR = collection('SKYE | Groom · skinned strand meshes')
RIG = collection('SKYE | Animation rig')
STUDIO = collection('STUDIO | Render only')
CTRL = collection('CONTROLS | Shapes')

def move(obj, coll):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    coll.objects.link(obj)

def lin(c):
    return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4

def rgb(h):
    if isinstance(h, str): return tuple(lin(int(h[i:i+2],16)/255) for i in (0,2,4))
    return h

def material(name, color, rough=.45, metal=0, coat=0, subsurface=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*rgb(color),1)
    p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=metal
    p.inputs['Coat Weight'].default_value=coat
    p.inputs['Subsurface Weight'].default_value=subsurface
    m.diffuse_color=(*rgb(color),1)
    return m

cream=material('Fur | warm cream', 'E8C68E', .79, subsurface=.06)
gold=material('Fur | honey gold', 'C88A43', .76, subsurface=.05)
darkgold=material('Fur | ear undercoat', 'AA6A2D', .76)
pink=material('Flight vest | raspberry woven nylon','D34883', .50, coat=.08)
pinklight=material('Flight gear | rose piping','F292BC', .43)
pinkdark=material('Flight gear | berry trim','9E2F61', .52)
rubber=material('Goggles | burgundy rubber seal','6B294A', .63)
metal=material('Hardware | brushed aluminium','C8D3D6', .26,.8)
white=material('Eye | ivory sclera','F8F3E9', .20, coat=.45)
black=material('Eye | pupil','130B19', .15, coat=.32)
lashmat=material('Lashes and brows | espresso','4D302B', .66)
nosemat=material('Nose | soft leather','3C2925', .50, coat=.035)
mouthmat=material('Mouth | warm shadow','341921', .70)
tonguemat=material('Mouth | tongue','C8777E', .51, subsurface=.10)
toothmat=material('Mouth | small milk teeth','F1EAD8', .28)
padmat=material('Paws | soft pads','8D6250', .68)
lensmat=material('Goggles | smoked rose glass','693850', .14, metal=.25, coat=.8)
lensmat.node_tree.nodes.get('Principled BSDF').inputs['IOR'].default_value=1.46
furmat=material('Fur | vertex-colour groom','FFFFFF',.68)
furmat.node_tree.nodes.get('Principled BSDF').inputs['Sheen Weight'].default_value=.28
furmat.node_tree.nodes.get('Principled BSDF').inputs['Sheen Roughness'].default_value=.64
vcol=furmat.node_tree.nodes.new('ShaderNodeVertexColor'); vcol.layer_name='Coat'
furmat.node_tree.links.new(vcol.outputs['Color'],furmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
skinmat=material('Skin under groom | vertex-colour markings','FFFFFF',.83,subsurface=.045)
vc=skinmat.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name='Coat'
skinmat.node_tree.links.new(vc.outputs['Color'],skinmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

def save_image(name, array, noncolor=False):
    h,w,_=array.shape
    im=bpy.data.images.new(name,width=w,height=h,alpha=True)
    if noncolor: im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(np.asarray(array,dtype=np.float32).ravel())
    im.filepath_raw=str(TEX/(name+'.png')); im.file_format='PNG'; im.save(); im.pack()
    return im

# Seamless, portable PBR textile normal. The GLB embeds the PNG.
N=512
gy,gx=np.mgrid[0:N,0:N]
nx=.16*np.sin(gx*2*pi/8)*(0.7+.3*np.cos(gy*2*pi/8))
ny=.16*np.sin(gy*2*pi/8)*(0.7+.3*np.cos(gx*2*pi/8))
normal=np.stack([.5+nx,.5+ny,np.sqrt(np.maximum(0,1-4*nx*nx-4*ny*ny))*.5+.5,np.ones_like(nx)],axis=-1)
fabric_normal=save_image('flight_fabric_normal',normal,True)
for m in (pink,pinkdark,pinklight):
    n=m.node_tree.nodes; l=m.node_tree.links
    t=n.new('ShaderNodeTexImage'); t.image=fabric_normal
    uv=n.new('ShaderNodeTexCoord'); mp=n.new('ShaderNodeVectorMath'); mp.operation='SCALE'; mp.inputs[3].default_value=5
    l.new(uv.outputs['UV'],mp.inputs[0]);l.new(mp.outputs['Vector'],t.inputs['Vector'])
    nm=n.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.28
    l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])

# Painted iris: radial fibres, limbal ring and a darker pupil edge.
N=1024; yy,xx=np.mgrid[-1:1:complex(N),-1:1:complex(N)]
rr=np.sqrt(xx*xx+yy*yy); aa=np.arctan2(yy,xx)
fibres=(np.sin(aa*123+rr*19)+.5*np.sin(aa*211-rr*31)+.35*np.sin(aa*379+rr*43))/1.85
fade=np.clip((1-rr)*10,0,1)*np.clip((rr-.40)*7,0,1)
col=np.zeros((N,N,4),np.float32); col[:,:,3]=1
for i,(base,amp) in enumerate([(0.47,.14),(.115,.05),(.33,.10)]):
    col[:,:,i]=np.clip((base+amp*fibres)*(.28+.72*fade),0,1)
col[rr<.43,:3]=[.008,.003,.012]
irisimage=save_image('skye_iris_1024',col)
irismat=material('Eye | magenta radial iris','FFFFFF',.15,coat=.9)
tn=irismat.node_tree.nodes.new('ShaderNodeTexImage');tn.image=irisimage
irismat.node_tree.links.new(tn.outputs['Color'],irismat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

def mesh(name,verts,faces,mat,coll=CHAR):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new(name,me);coll.objects.link(o)
    if mat:me.materials.append(mat)
    for p in me.polygons:p.use_smooth=True
    return o

def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def apply(o,mod):
    active(o);bpy.ops.object.modifier_apply(modifier=mod.name)

def ellipsoid(name,center,scale,mat,segments=48,rings=32,rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=center)
    o=bpy.context.object;o.name=name;o.scale=scale
    if rotation:o.rotation_euler=rotation
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    move(o,CHAR)
    if mat:o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o

def box(name,center,size,mat,bevel=.06):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center)
    o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=True,rotation=False,scale=True);move(o,CHAR)
    o.data.materials.append(mat)
    b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=4;apply(o,b)
    n=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');apply(o,n)
    return o

def curve(name,pts,radius,mat,radii=None,cyclic=False,coll=CHAR):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=12
    cu.bevel_depth=radius;cu.bevel_resolution=3
    sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
    for i,(p,co) in enumerate(zip(sp.bezier_points,pts)):
        p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
        if radii:p.radius=radii[i]
    sp.use_cyclic_u=cyclic
    o=bpy.data.objects.new(name,cu);coll.objects.link(o)
    if mat:cu.materials.append(mat)
    active(o);bpy.ops.object.convert(target='MESH')
    return bpy.context.object

def tube(name,points,radii,mat,sides=24,subdiv=2):
    vs=[];fs=[]
    for i,p in enumerate(points):
        p=Vector(p)
        t=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)]);t.normalize()
        ax=t.cross(Vector((0,1,0)))
        if ax.length<.1:ax=t.cross(Vector((1,0,0)))
        ax.normalize();ay=t.cross(ax).normalized()
        rad=radii[i];rx,ry=rad if isinstance(rad,(tuple,list)) else (rad,rad)
        for j in range(sides):
            a=2*pi*j/sides;vs.append(p+rx*cos(a)*ax+ry*sin(a)*ay)
    for i in range(len(points)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;fs.append((a,b,b+sides,a+sides))
    fs.append(tuple(range(sides-1,-1,-1)));fs.append(tuple((len(points)-1)*sides+j for j in range(sides)))
    o=mesh(name,vs,fs,mat)
    if subdiv:
        m=o.modifiers.new('Organic quad surface','SUBSURF');m.levels=subdiv;apply(o,m)
    return o

def union(name,objs,voxel=.026):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();o=objs[0];o.name=name
    rem=o.modifiers.new('Continuous sculpt surface','REMESH');rem.mode='VOXEL';rem.voxel_size=voxel;rem.use_smooth_shade=True;apply(o,rem)
    sm=o.modifiers.new('Relax sculpt','SMOOTH');sm.factor=.65;sm.iterations=4;apply(o,sm)
    return o

def uv_smart(o):
    active(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=.025);bpy.ops.object.mode_set(mode='OBJECT')

def coat(o,fn):
    att=o.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
    a=[]
    for v in o.data.vertices:a.extend((*fn(v.co),1))
    att.data.foreach_set('color',a)
    o.data.materials.clear();o.data.materials.append(skinmat)

def blend(a,b,t):return tuple(x*(1-t)+y*t for x,y in zip(a,b))
CREAM=rgb('E7C58D');GOLD=rgb('C68B48');PALE=rgb('F1D9B1');EAR=rgb('BD803C')
def head_color(p):
    x,y,z=p
    eye=min(((x-s*.29)/.30)**2+((z-2.46)/.48)**2 for s in (-1,1))
    mask=max(0,min(1,(1.55-eye)/.64))*max(0,min(1,(-y-.76)*6))
    mask=mask*mask*(3-2*mask)
    bridge=max(0,min(1,(abs(x)-.075)/.115));bridge=bridge*bridge*(3-2*bridge)
    mask*=bridge
    return blend(CREAM,rgb('B77939'),mask)
def body_color(p):
    x,y,z=p
    return blend(GOLD,PALE,max(0,min(1,(.53-z)*8)))

# Deformation skeleton, with animator-friendly IK feet and pole controls.
arm=bpy.data.armatures.new('Skye skeleton');rig=bpy.data.objects.new('Skye_Rig',arm);RIG.objects.link(rig)
active(rig);bpy.ops.object.mode_set(mode='EDIT')
BONES={}
def bone(name,head,tail,parent=None,deform=True):
    b=arm.edit_bones.new(name);b.head=head;b.tail=tail;b.use_deform=deform
    if parent:b.parent=arm.edit_bones[parent]
    BONES[name]=(Vector(head),Vector(tail));return b
bone('root',(0,0,.10),(0,0,.5))
bone('pelvis',(0,.78,1.12),(0,.40,1.19),'root')
bone('spine',(0,.40,1.19),(0,.04,1.29),'pelvis')
bone('chest',(0,.04,1.29),(0,-.35,1.40),'spine')
bone('neck',(0,-.35,1.40),(0,-.61,1.85),'chest')
bone('head',(0,-.61,1.85),(0,-.72,2.58),'neck')
bone('jaw',(0,-.91,1.96),(0,-1.29,1.865),'head')
bone('tongue',(0,-1.09,1.846),(0,-1.275,1.85),'jaw')
for s,side in [(1,'L'),(-1,'R')]:
    bone('eye.'+side,(s*.268,-1.083,2.415),(s*.268,-1.29,2.415),'head')
    bone('brow.'+side,(s*.245,-1.06,2.735),(s*.245,-1.06,2.82),'head')
    bone('lip_corner.'+side,(s*.27,-1.25,1.895),(s*.27,-1.25,1.96),'head')
    bone('strap.'+side,(s*.61,-.73,2.39),(s*.62,-.77,1.68),'head')
    bone('ear_base.'+side,(s*.53,-.58,2.59),(s*.77,-.48,2.25),'head')
    bone('ear_mid.'+side,(s*.77,-.48,2.25),(s*.85,-.46,1.96),'ear_base.'+side)
    bone('ear_tip.'+side,(s*.85,-.46,1.96),(s*.79,-.51,1.68),'ear_mid.'+side)
    for limb,points in [('front',[(s*.29,-.28,1.29),(s*.29,-.19,.78),(s*.29,-.43,.28),(s*.29,-.63,.14)]),('hind',[(s*.34,.76,1.16),(s*.36,.53,.72),(s*.34,.87,.30),(s*.34,.65,.15)])]:
        parent='chest' if limb=='front' else 'pelvis'
        for i,label in enumerate(['upper','lower','paw']):
            nm=f'{limb}_{label}.{side}';bone(nm,points[i],points[i+1],parent);parent=nm
        target=f'CTRL_{limb}_foot.{side}';p=points[2]
        bone(target,p,points[3],'root',False)
        pole=f'CTRL_{limb}_pole.{side}'
        a,b,c=map(Vector,points[:3]);axis=(c-a).normalized()
        bend=b-a-axis*((b-a).dot(axis));po=b+bend.normalized()*.85
        bone(pole,po,(po[0],po[1],po[2]+.15),'root',False)
bone('tail_01',(0,1.03,1.17),(0,1.36,1.20),'pelvis')
bone('tail_02',(0,1.36,1.20),(0,1.58,1.38),'tail_01')
bone('tail_03',(0,1.58,1.38),(0,1.57,1.64),'tail_02')
bone('pack',(0,.20,1.51),(0,.20,1.86),'spine')
for s,side in [(1,'L'),(-1,'R')]:bone('wing.'+side,(s*.39,.22,1.75),(s*1.3,.22,1.75),'pack')
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True;arm.display_type='BBONE'
rig['README']='Select green foot controls for IK; rotate head, jaw, ears, tail and wings. NLA tracks contain baked-exportable demo actions. Blink is a shape key on Upper_lids.'
for pb in rig.pose.bones:
    pb.rotation_mode='QUATERNION'
    pb.color.palette='THEME03' if pb.name.startswith('CTRL') else 'THEME04'
for s,side in [(1,'L'),(-1,'R')]:
    for limb in ('front','hind'):
        c=rig.pose.bones[f'{limb}_lower.{side}'].constraints.new('IK')
        c.name='Two-bone leg IK';c.target=rig;c.subtarget=f'CTRL_{limb}_foot.{side}';c.chain_count=2;c.use_stretch=False
        c.pole_target=rig;c.pole_subtarget=f'CTRL_{limb}_pole.{side}';c.pole_angle=-pi/2
        # Calibrate each pole against the authored rest knee, before skin is created.
        best=(1e9,0)
        for angle in np.linspace(-pi,pi,97):
            c.pole_angle=float(angle);bpy.context.view_layer.update()
            error=(rig.pose.bones[f'{limb}_upper.{side}'].tail-BONES[f'{limb}_upper.{side}'][1]).length
            if error<best[0]:best=(error,float(angle))
        for angle in np.linspace(best[1]-pi/96,best[1]+pi/96,41):
            c.pole_angle=float(angle);bpy.context.view_layer.update()
            error=(rig.pose.bones[f'{limb}_upper.{side}'].tail-BONES[f'{limb}_upper.{side}'][1]).length
            if error<best[0]:best=(error,float(angle))
        c.pole_angle=best[1]
        cr=rig.pose.bones[f'{limb}_paw.{side}'].constraints.new('COPY_ROTATION')
        cr.name='Keep planted paw orientation';cr.target=rig;cr.subtarget=f'CTRL_{limb}_foot.{side}'
        cr.owner_space='POSE';cr.target_space='POSE';cr.mix_mode='REPLACE'

def weights(o,fn):
    groups={}
    for v in o.data.vertices:
        ws=fn(v.co) if callable(fn) else {fn:1}
        ws={k:max(0,vv) for k,vv in ws.items() if vv>1e-5};total=sum(ws.values())
        for k,w in ws.items():
            if k not in groups:groups[k]=o.vertex_groups.new(name=k)
            groups[k].add([v.index],w/total,'REPLACE')
    mod=o.modifiers.new('Skye skin deformation','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True
    o.parent=rig
    return o

def segdist(p,a,b):
    v=b-a;t=max(0,min(1,(p-a).dot(v)/v.length_squared));return (p-a-t*v).length
def chain_weights(p,names,power=4):
    ds=[segdist(p,*BONES[n]) for n in names]
    v=[1/(d+.07)**power for d in ds];sv=sum(v)
    return {n:w/sv for n,w in zip(names,v)}
def torso_weights(p):
    x,y,z=p
    if z>1.40 and y<-.18:
        t=max(0,min(1,(z-1.37)/.45));return {'neck':.65*t,'chest':1-.65*t}
    if z<1.31 and abs(x)>.12:
        side='L' if x>0 else 'R';limb='front' if y<.17 else 'hind'
        if z<.25:return {f'{limb}_paw.{side}':1}
        ww=chain_weights(p,[f'{limb}_upper.{side}',f'{limb}_lower.{side}',f'{limb}_paw.{side}'])
        t=max(0,min(1,(1.31-z)/.25));ww={k:v*t for k,v in ww.items()}
        ww['chest' if limb=='front' else 'pelvis']=1-t;return ww
    t=max(0,min(1,(y+.08)/.82))
    if t<.5:return {'chest':1-2*t,'spine':2*t}
    return {'spine':2-2*t,'pelvis':2*t-1}

print('Building continuous body and head',flush=True)
parts=[ellipsoid('Torso sculpt',(0,.30,1.17),(.355,.70,.38),gold),ellipsoid('Chest sculpt',(0,-.25,1.32),(.33,.32,.40),gold),ellipsoid('Neck sculpt',(0,-.42,1.62),(.25,.28,.37),gold)]
for s,side in [(1,'L'),(-1,'R')]:
    points=[(s*.28,-.25,1.26),(s*.29,-.205,1.08),(s*.29,-.19,.78),(s*.29,-.32,.48),(s*.29,-.43,.26)]
    parts.append(tube('Foreleg sculpt',points,[.18,.165,.125,.108,.10],gold))
    points=[(s*.27,.76,1.22),(s*.34,.71,1.01),(s*.36,.53,.74),(s*.35,.70,.49),(s*.34,.87,.29)]
    parts.append(tube('Hindleg sculpt',points,[.23,.225,.162,.104,.09],gold))
    for limb,y in [('front',-.53),('hind',.76)]:
        x=s*(.29 if limb=='front' else .34)
        parts.append(ellipsoid('Paw sculpt',(x,y,.16),(.157,.215,.145),cream,32,20))
body=union('Body | continuous neck, torso and four legs',parts,.023)
coat(body,body_color);weights(body,torso_weights);uv_smart(body)

head=union('Head | sculpted cranium and cheeks',[
    ellipsoid('Cranium',(0,-.72,2.32),(.595,.498,.625),cream),
    ellipsoid('Cheek.L',(.29,-.835,2.025),(.305,.33,.285),cream),
    ellipsoid('Cheek.R',(-.29,-.835,2.025),(.305,.33,.285),cream),
    ellipsoid('Chin',(0,-.835,1.855),(.33,.27,.16),cream)],.013)
def head_weights(p):
    t=max(0,min(1,(2.08-p.z)/.32));t=t*t*(3-2*t)
    jaw=.55*t*max(0,min(1,(-p.y-.62)/.45))
    return {'head':1-jaw,'jaw':jaw}
coat(head,head_color);weights(head,head_weights);uv_smart(head)

muzzle=union('Muzzle | blended cream cheeks',[
    ellipsoid('Muzzle | unified soft pad',(0,-1.209,2.045),(.36,.230,.184),cream,80,52),
    ellipsoid('Nasal bridge',(0,-1.191,2.14),(.13,.155,.188),cream)],.012)
def muzzle_weights(p):
    t=.40*exp(-((abs(p.x)-.265)/.12)**2-((p.z-1.91)/.115)**2)
    return {'head':1-t,'lip_corner.'+('L' if p.x>0 else 'R'):t}
coat(muzzle,lambda p:PALE);weights(muzzle,muzzle_weights);uv_smart(muzzle)
from face_system import build_face
lids=build_face(globals())
sk=lids.data.shape_keys

print('Building floppy ears and sculpted forelock',flush=True)
ears=[]
for s,side in [(1,'L'),(-1,'R')]:
    points=[(s*.50,-.55,2.62),(s*.68,-.49,2.48),(s*.80,-.46,2.28),(s*.87,-.44,2.04),(s*.86,-.48,1.82),(s*.76,-.55,1.69)]
    ear=tube('Ear | continuous curled silhouette.'+side,points,[(.10,.075),(.19,.10),(.225,.13),(.26,.15),(.23,.145),(.07,.045)],gold,sides=32,subdiv=2)
    coat(ear,lambda p:blend(EAR,GOLD,max(0,min(1,(p.z-1.7)/.9))))
    weights(ear,lambda p,si=side:chain_weights(p,[f'ear_base.{si}',f'ear_mid.{si}',f'ear_tip.{si}']))
    uv_smart(ear);ears.append(ear)
for i,(pts,rs) in enumerate([
    ([(-.035,-.79,2.875),(0,-.87,2.975),(.10,-.86,3.06),(.20,-.77,3.06),(.23,-.75,3.015)],[.105,.12,.08,.035,.003]),
    ([(-.07,-.75,2.90),(-.105,-.84,3.025),(-.08,-.78,3.155),(.015,-.71,3.20),(.065,-.665,3.20)],[.085,.086,.065,.031,.002]),
    ([(.02,-.82,2.92),(.10,-.97,2.93),(.13,-1.025,2.857),(.115,-1.03,2.817)],[.075,.075,.050,.002])]):
    o=tube('Forelock | sculpted curl %02d'%i,pts,rs,gold,24,2);weights(o,'head')

# Tail: continuous tapered quad tube and three flexible bones.
tail=tube('Tail | curled plume',[(0,1.00,1.16),(0,1.17,1.18),(0,1.39,1.22),(0,1.57,1.40),(0,1.59,1.59),(0,1.52,1.70)],[.14,.133,.118,.09,.053,.006],gold,28,2)
coat(tail,lambda p:blend(GOLD,CREAM,max(0,min(1,(p.z-1.3)*2))))
weights(tail,lambda p:chain_weights(p,['tail_01','tail_02','tail_03']));uv_smart(tail)

print('Tailoring flight vest and goggles',flush=True)
def vest_region(p):
    x,y,z=p
    if y>.60 or z>1.727:return False
    if z<.99:return False
    if abs(x)>.19 and ((y+.20)/.275)**2+((z-1.095)/.265)**2<1:return False
    return True
# Reuse the body's sculpted surface so cloth shares the exact skin deformation.
vs=[v.co+v.normal*.020 for v in body.data.vertices]
fs=[tuple(p.vertices) for p in body.data.polygons if vest_region(p.center)]
used=sorted(set(i for f in fs for i in f));remap={i:j for j,i in enumerate(used)}
vv=[vs[i] for i in used];ff=[tuple(remap[i] for i in f) for f in fs]
vest=mesh('Vest | fitted continuous shell with armholes',vv,ff,pink)
edgecount={}
for f in ff:
    for a,b in zip(f,f[1:]+f[:1]):
        e=tuple(sorted((a,b)));edgecount[e]=edgecount.get(e,0)+1
boundary=[e for e,c in edgecount.items() if c==1]
adj={}
for a,b in boundary:adj.setdefault(a,[]).append(b);adj.setdefault(b,[]).append(a)
remaining=set(tuple(sorted(e)) for e in boundary)
while remaining:
    a,b=next(iter(remaining));loop=[a,b];remaining.discard(tuple(sorted((a,b))))
    while True:
        poss=[v for v in adj[loop[-1]] if tuple(sorted((loop[-1],v))) in remaining]
        if not poss:break
        v=poss[0];remaining.discard(tuple(sorted((loop[-1],v))));loop.append(v)
        if v==loop[0]:break
    if len(loop)>5:
        coords=[Vector(vv[i]) for i in loop[:-1]]
        for it in range(4):coords=[(coords[(j-1)%len(coords)]+coords[j]*2+coords[(j+1)%len(coords)])/4 for j in range(len(coords))]
        weights(curve('Vest | bound opening',[p for j,p in enumerate(coords) if j%3==0],.016,pinkdark,cyclic=True),torso_weights)
uv_smart(vest)
source_indices=iter(used)
def exact_cloth_weights(p):
    v=body.data.vertices[next(source_indices)]
    return {body.vertex_groups[g.group].name:g.weight for g in v.groups}
weights(vest,exact_cloth_weights)
so=vest.modifiers.new('Fabric thickness','SOLIDIFY');so.thickness=.012;so.offset=1
vest.modifiers.move(vest.modifiers.find(so.name),0);apply(vest,so)
collar=tube('Collar | pale rose band',[(0,-.49,1.676),(0,-.51,1.722),(0,-.51,1.768)],[(.258,.229),(.255,.226),(.253,.224)],pinklight,48,1)
weights(collar,'neck');uv_smart(collar)
def front_surface(z):
    return min(v.co.y for v in body.data.vertices if abs(v.co.x)<.05 and abs(v.co.z-z)<.028)-.042
weights(curve('Vest | front zipper',[(0,front_surface(z),z) for z in np.linspace(1.10,1.67,15)],.006,metal),'chest')
for i in range(25):
    z=1.10+i*.023;y=front_surface(z)
    weights(box('Zipper tooth',(0,y-.004,z),(.022,.010,.008),metal,.002),'chest')
weights(box('Zipper pull',(0,front_surface(1.57)-.01,1.57),(.032,.016,.062),metal,.009),'chest')

# Flight badge: raised shield with three-blade propeller motif.
def shield(name,c,scale,mat,depth=.018):
    outline=[(-.72,1),(.72,1),(.90,.72),(.69,-.32),(0,-1),(-.69,-.32),(-.90,.72)]
    vv=[(c[0]+x*scale,c[1]+dy,c[2]+z*scale) for dy in [0,depth] for x,z in outline]
    ff=[tuple(range(6,-1,-1)),tuple(range(7,14))]+[(i,(i+1)%7,(i+1)%7+7,i+7) for i in range(7)]
    o=mesh(name,vv,ff,mat);b=o.modifiers.new('Rounded enamel rim','BEVEL');b.width=.011;b.segments=3;apply(o,b);return o
weights(shield('Badge | silver shield',(0,-.773,1.592),.153,metal),'neck')
weights(shield('Badge | raspberry enamel',(0,-.790,1.598),.125,pinkdark),'neck')
weights(ellipsoid('Badge | propeller hub',(0,-.813,1.60),(.022,.011,.024),white,24,16),'neck')
for a in [pi/2,pi/2+2*pi/3,pi/2+4*pi/3]:
    x=.051*cos(a);z=1.60+.051*sin(a)
    ob=ellipsoid('Badge | propeller blade',(x,-.809,z),(.024,.009,.056),white,24,16)
    # Rotate around the blade centre inside world-space mesh.
    for v in ob.data.vertices:
        q=v.co-Vector((x,-.809,z));ang=a-pi/2
        v.co=Vector((x+q.x*cos(ang)-q.z*sin(ang),-.809+q.y,z+q.x*sin(ang)+q.z*cos(ang)))
    weights(ob,'neck')
for ob in CHAR.objects:
    if ob.name.startswith('Badge |'):
        for v in ob.data.vertices:v.co+=Vector((0,-.015,-.095))

# Woven head strap wrapping behind the ears.
pts=[]
for a in np.linspace(0,2*pi,56,endpoint=False):pts.append((.615*cos(a),-.54-.06*sin(a),2.32+.62*sin(a)))
weights(curve('Goggles | fitted headband',pts,.035,pinkdark,cyclic=True),'head')
for s,side in [(1,'L'),(-1,'R')]:
    cx=s*.283;cy=-.749;cz=2.967
    # Frames are slightly tilted to follow the top of the head.
    pts=[(cx+.238*cos(a),cy+.135*sin(a),cz+.092*sin(a)) for a in np.linspace(0,2*pi,44,endpoint=False)]
    weights(curve('Goggle | rubber seal.'+side,pts,.035,rubber,cyclic=True),'head')
    pts=[(x,y-.014,z+.025) for x,y,z in pts]
    weights(curve('Goggle | rose frame.'+side,pts,.027,pink,cyclic=True),'head')
    o=ellipsoid('Goggle | curved smoked lens.'+side,(cx,cy-.005,cz+.010),(.207,.115,.044),lensmat,48,24,rotation=(.61,0,0));weights(o,'head')
    weights(curve('Goggle | lens glint.'+side,[(cx-.12,cy-.039,cz+.057),(cx-.08,cy-.070,cz+.042),(cx+.01,cy-.078,cz+.034)],.006,pinklight,radii=[.1,.65,.1]),'head')
    weights(box('Goggle | side buckle.'+side,(s*.539,-.745,2.928),(.039,.082,.068),metal,.014),'head')
    pts=[(s*.55,-.736,2.936),(s*.626,-.72,2.32),(s*.632,-.73,1.97),(s*.617,-.80,1.66)]
    # Flat flexible strap with rounded edges; bone bound with the head.
    vv=[];ff=[]
    for i,p in enumerate(pts):
        for dx in [-.026,.026]:vv.append((p[0]+dx,p[1],p[2]))
    for i in range(3):ff.append((2*i,2*i+1,2*i+3,2*i+2))
    o=mesh('Goggles | hanging strap.'+side,vv,ff,pink)
    sub=o.modifiers.new('Soft ribbon','SUBSURF');sub.levels=2;apply(o,sub)
    sol=o.modifiers.new('Ribbon thickness','SOLIDIFY');sol.thickness=.012;apply(o,sol)
    weights(o,lambda p,si=side:{'head':max(0,min(1,(p.z-2.3)/.25)),'strap.'+si:1-max(0,min(1,(p.z-2.3)/.25))});uv_smart(o)

print('Building mechanical flight pack and folding wings',flush=True)
weights(box('Pup pack | padded lower mount',(0,.29,1.59),(.55,.68,.19),pinkdark,.10),'pack')
weights(box('Pup pack | main housing',(0,.35,1.79),(.59,.63,.31),pink,.10),'pack')
weights(box('Pup pack | top panel',(0,.35,1.944),(.45,.46,.047),pinklight,.052),'pack')
weights(box('Pup pack | rear hatch',(0,.677,1.80),(.39,.027,.18),pinkdark,.037),'pack')
for s,side in [(1,'L'),(-1,'R')]:
    weights(ellipsoid('Pup pack | hinge.'+side,(s*.32,.24,1.755),(.098,.12,.105),metal,32,20),'pack')
    # Aerodynamic swept wing, soft bevel along each edge.
    profile=[(.36,-.005),(1.27,-.06),(1.56,.06),(1.50,.25),(.55,.48),(.37,.39)]
    vv=[(s*x,y+.07,z) for z in [1.742,1.800] for x,y in profile]
    ff=[tuple(range(5,-1,-1)),tuple(range(6,12))]+[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)]
    o=mesh('Flight wing | aluminium airfoil.'+side,vv,ff,metal)
    be=o.modifiers.new('Airfoil edge radius','BEVEL');be.width=.034;be.segments=4;apply(o,be);weights(o,'wing.'+side)
    pts=[(s*.58,.112,1.809),(s*.92,.071,1.809),(s*1.29,.065,1.804),(s*1.46,.146,1.795)]
    weights(curve('Flight wing | rose leading edge.'+side,pts,.033,pink),'wing.'+side)
    weights(box('Flight wing | tip light.'+side,(s*1.466,.221,1.799),(.069,.086,.030),pinklight,.016),'wing.'+side)
    for y in [.45,.50,.55]:weights(box('Pup pack | cooling vent.'+side,(s*.297,y,1.807),(.013,.018,.111),rubber,.004),'pack')
for s,side in [(1,'L'),(-1,'R')]:
    for limb,y in [('front',-.53),('hind',.76)]:
        x=s*(.29 if limb=='front' else .34);bn=f'{limb}_paw.{side}'
        weights(ellipsoid('Paw | underside pad',(x,y,.038),(.086,.105,.012),padmat,28,16),bn)
        for dx in [-.079,0,.079]:
            weights(ellipsoid('Paw | toe pad',(x+dx,y-.092,.041),(.029,.035,.010),padmat,24,12),bn)
        for dx in [-.049,.049]:
            weights(curve('Paw | toe separation',[(x+dx,y-.203,.13),(x+dx,y-.195,.19),(x+dx,y-.153,.243)],.006,gold,radii=[.15,.75,.08]),bn)

print('Grooming portable, fully skinned fur strands',flush=True)
def groom(source,count,length,width,name,filter_fn=None,color_fn=None,flow=None):
    if '--draft-face' in sys.argv or '--draft-mouth' in sys.argv:return
    source.data.calc_loop_triangles()
    verts=np.array([v.co[:] for v in source.data.vertices],dtype=np.float64)
    norms=np.array([v.normal[:] for v in source.data.vertices],dtype=np.float64)
    tris=np.array([t.vertices[:] for t in source.data.loop_triangles],dtype=np.int32)
    ar=np.linalg.norm(np.cross(verts[tris[:,1]]-verts[tris[:,0]],verts[tris[:,2]]-verts[tris[:,0]]),axis=1)
    ix=rng.choice(len(tris),count,p=ar/ar.sum());chosen=tris[ix]
    uv=rng.random((count,2));uv[uv.sum(axis=1)>1]=1-uv[uv.sum(axis=1)>1]
    bary=np.stack([1-uv[:,0]-uv[:,1],uv[:,0],uv[:,1]],axis=1)
    points=np.sum(verts[chosen]*bary[:,:,None],axis=1)
    normals=np.sum(norms[chosen]*bary[:,:,None],axis=1)
    normals/=np.linalg.norm(normals,axis=1)[:,None]
    srcws=[]
    for v in source.data.vertices:srcws.append({source.vertex_groups[g.group].name:g.weight for g in v.groups})
    vs=[];faces=[];colors=[];strandweights=[]
    for k,(p,n) in enumerate(zip(points,normals)):
        pp=Vector(p);nn=Vector(n)
        if filter_fn and not filter_fn(pp,nn):continue
        tangent=Vector(flow(pp,nn) if flow else (p[0]*.15,.08,-.6))
        tangent=(tangent-nn*tangent.dot(nn))
        if tangent.length<.001:tangent=nn.cross(Vector((1,0,0)))
        tangent.normalize();side=nn.cross(tangent).normalized()
        le=length*random.uniform(.78,1.23);w=width*random.uniform(.70,1.03)
        color=color_fn(pp) if color_fn else (color_fn or GOLD)
        shade=random.uniform(.94,1.055)
        color=tuple(max(0,min(1,c*shade)) for c in color)
        ws={}
        for vi,fac in zip(chosen[k],bary[k]):
            for bn,weight in srcws[vi].items():ws[bn]=ws.get(bn,0)+weight*fac
        ws=dict(sorted(ws.items(),key=lambda x:-x[1])[:4]);total=sum(ws.values());ws={n:v/total for n,v in ws.items()}
        off=len(vs)
        phase=pp.x*17+pp.z*23+pp.y*11
        for t,rad in [(0,w*.68),(.34,w),(.70,w*.45)]:
            bend=le*.14*(sin(phase+t*pi*1.65)-sin(phase))*t
            c=pp+nn*(le*(.18*t+.12*sin(t*pi)))+tangent*(le*t)+side*bend
            for a in (0,2*pi/3,4*pi/3):vs.append(c+rad*(cos(a)*side+sin(a)*nn))
        vs.append(pp+nn*(le*.18)+tangent*le+side*(le*.14*(sin(phase+pi*1.65)-sin(phase))))
        for k0 in [0,3]:faces.extend([(off+k0+j,off+k0+(j+1)%3,off+k0+(j+1)%3+3,off+k0+j+3) for j in range(3)])
        faces.extend([(off+6+j,off+6+(j+1)%3,off+9) for j in range(3)])
        for brightness,num in [(.88,3),(.97,3),(1.03,3),(1.06,1)]:colors.extend([(*(min(1,c*brightness) for c in color),1)]*num)
        strandweights.extend([ws]*10)
    o=mesh(name,vs,faces,furmat,FUR)
    at=o.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT');at.data.foreach_set('color',np.array(colors,dtype=np.float32).ravel())
    g={bn:o.vertex_groups.new(name=bn) for bn in set(n for w in strandweights for n in w)}
    for i,ws in enumerate(strandweights):
        for bn,val in ws.items():g[bn].add([i],val,'REPLACE')
    m=o.modifiers.new('Groom follows skin','ARMATURE');m.object=rig;o.parent=rig
    o['strand_count']=len(vs)//10
    return o
def head_filter(p,n):
    x,y,z=p
    if y<-.99:
        for s in [-1,1]:
            if ((x-s*.268)/.222)**2+((z-2.415)/.279)**2<1.06:return False
        if abs(x)<.39 and z<2.20:return False
    return not (z>2.79 and abs(x)>.13)
groom(head,48000,.017,.00058,'Groom | face and scalp',head_filter,head_color,lambda p,n:(p.x*.40+.07*sin(p.z*10),-.035,-.46))
from mouth_system import seam_z
groom(muzzle,8800,.010,.00049,'Groom | cream muzzle',lambda p,n:p.y<-1.20 and p.z>seam_z(p.x)+.008,lambda p:PALE,lambda p,n:(p.x,-.06,-.12))
groom(body,40000,.023,.00066,'Groom | body and paws',lambda p,n:not vest_region(p) and p.z<1.78,body_color)
for o in ears:groom(o,22000,.050,.00083,'Groom | feathered '+o.name,None,lambda p:blend(EAR,GOLD,.38),lambda p,n:(.28*sin(p.z*16+abs(p.x)*12),-.12,-1))
for o in list(CHAR.objects):
    if o.name.startswith('Jaw | rounded'):
        groom(o,3400,.008,.00042,'Groom | rounded chin',lambda p,n:p.y<-1.13 and p.z<seam_z(p.x)-.023,lambda p:PALE,lambda p,n:(p.x*.6,-.08,-.35))
    if o.name.startswith('Forelock |'):
        groom(o,2600,.012,.00070,'Groom | '+o.name,None,lambda p:GOLD,lambda p,n:(.25,.3,.45))
groom(tail,5500,.046,.0013,'Groom | tail plume',None,lambda p:GOLD,lambda p,n:(0,.5,.45))

print('Authoring coordinated facial and skeletal performances',flush=True)
from animation_system import build_animations
clips,sk=build_animations(rig,lids,OUT)
scene.frame_start=1;scene.frame_end=181;scene.frame_set(1)

# Simple unobtrusive foot-control shapes, editable in the native project.
shape=curve('Foot controller',[(.19*cos(a),.27*sin(a),0) for a in np.linspace(0,2*pi,32,endpoint=False)],.009,None,cyclic=True,coll=CTRL)
shape.hide_render=True;shape.hide_set(True)
for pb in rig.pose.bones:
    if pb.name.startswith('CTRL_') and '_foot.' in pb.name:
        pb.custom_shape=shape;pb.use_custom_shape_bone_size=False
        pb.custom_shape_rotation_euler=(pi/2,0,0)

# Studio lighting and cameras, excluded from the asset exports.
floor_mat=material('Studio | warm porcelain','C9D3D8',.80)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.011));floor=bpy.context.object;floor.name='Studio ground';floor.data.materials.append(floor_mat);move(floor,STUDIO)
world=bpy.data.worlds.new('Soft blue studio');scene.world=world;world.use_nodes=True
world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.29,.36,.46,1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.38
def area(name,pos,power,color,size,target=(0,0,1.5)):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);STUDIO.objects.link(ob);ob.location=pos
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler();return ob
area('Key | large silk',(-3.4,-4.7,6.5),520,(1,.84,.68),4.0)
area('Fill | soft cool',(3.6,-2.1,3.6),320,(.71,.85,1),3.2)
area('Rim | warm hair light',(1.5,3.8,4.9),680,(1,.77,.58),3.0)
area('Eye softbox',(-.3,-5.0,3.2),65,(1,.94,.9),1.5)
def camera(name,loc,target,ortho):
    data=bpy.data.cameras.new(name);ob=bpy.data.objects.new(name,data);STUDIO.objects.link(ob)
    ob.location=loc;ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=ortho;data.lens=65;return ob
cam=camera('Camera | hero',(3.5,-7.5,3.05),(0,-.03,1.55),3.96);scene.camera=cam
camera('Camera | front',(0,-8,2.40),(0,-.1,1.58),3.72)
camera('Camera | side',(8,0,2.30),(0,.02,1.59),4.35)
camera('Camera | back',(3.6,6,3.2),(0,.12,1.53),4.0)
camera('Camera | face',(1.25,-6.0,2.72),(0,-.86,2.40),1.90)
camera('Camera | mouth detail',(1.65,-5.0,2.18),(0,-1.18,1.935),1.20)
camera('Camera | mouth profile',(5,-3.8,2.28),(0,-1.15,2.07),1.60)

if '--draft-face' in sys.argv or '--draft-mouth' in sys.argv:
    review=ROOT/'.tools'/'face-review';review.mkdir(parents=True,exist_ok=True)
    scene.camera=bpy.data.objects['Camera | face']
    scene.render.resolution_x=680;scene.render.resolution_y=800;scene.cycles.samples=16
    from render_device import configure
    if configure(scene)=='OPTIX':scene.cycles.denoiser='OPTIX'
    mouth_draft='--draft-mouth' in sys.argv
    if mouth_draft:
        rig.animation_data.action=bpy.data.actions['Mouth_OpenClose'];sk.animation_data.action=bpy.data.actions['Mouth_OpenClose_Face']
    for f in ([1,40,75,106,151] if mouth_draft else [1,45,46]):
        scene.frame_set(f);scene.render.filepath=str(review/f'{"mouth" if mouth_draft else "fit"}_{f}.png');bpy.ops.render.render(write_still=True)
    if mouth_draft:
        scene.camera=bpy.data.objects['Camera | mouth profile'];scene.frame_set(106)
        scene.render.filepath=str(review/'mouth_profile.png');bpy.ops.render.render(write_still=True)
    print('DRAFT_FACE_COMPLETE',flush=True)
    sys.exit(0)

print('Saving native project and exporting GLB / FBX',flush=True)
for obj in list(CHAR.objects):
    if obj.type=='MESH' and not obj.data.uv_layers:uv_smart(obj)
active(rig)
for area_ui in bpy.context.screen.areas:
    if area_ui.type=='VIEW_3D':
        area_ui.spaces.active.region_3d.view_distance=4.7
        area_ui.spaces.active.region_3d.view_location=(0,0,1.55)
        area_ui.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
        area_ui.spaces.active.shading.type='MATERIAL'
for o in STUDIO.objects:
    if o.type in {'LIGHT','CAMERA'}:o.hide_set(True)
scene.camera=cam
scene['Asset']='Skye / 天天 · reference-based reconstruction'
scene['Animation_clips']='See output/animation_catalog.json: eleven coordinated performances'
scene['Asset_version']='2.1 · sealed mouth and articulated jaw'
scene['Reference_sources']='See references/SOURCES.md'
rig['README']='Use Open_Skye.cmd for the Skye sidebar. Foot targets keep paw orientation; brows, lip corners, tongue, eyes and straps have individual bones. BlinkArc is synchronized in the action library.'
for name,predicate in [('Face',lambda n:n in ['head','jaw','tongue'] or n.startswith(('eye.','brow.','lip_corner.'))),('Leg IK',lambda n:n.startswith('CTRL_')),('Secondary motion',lambda n:n.startswith(('ear_','tail_','strap.'))),('Flight gear',lambda n:n in ['pack','wing.L','wing.R'])]:
    co=arm.collections.new(name)
    for b in arm.bones:
        if predicate(b.name):co.assign(b)
txt=bpy.data.texts.new('Skye controls — Run Script to show sidebar');txt.write((ROOT/'scripts'/'skye_controls.py').read_text(encoding='utf-8'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Skye_Rigged.blend'),compress=True)

# NLA mode merges facial and skeletal tracks with the same name.
rig.animation_data.action=None
sk.animation_data.action=None
for tr in rig.animation_data.nla_tracks:tr.mute=False
for tr in sk.animation_data.nla_tracks:tr.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for co in [CHAR,FUR]:
    for o in co.objects:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'Skye_Animated.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_anim_slide_to_zero=True,export_def_bones=True,export_force_sampling=True,export_tangents=True,export_morph=True,export_morph_animation=True,export_materials='EXPORT',export_extras=True)
sys.path.insert(0,str(ROOT/'scripts'))
from gltf_tools import root_skinned_meshes
root_skinned_meshes(OUT/'Skye_Animated.glb')
# FBX carries portable geometry/material slots and all ten baked armature actions.
for tr in rig.animation_data.nla_tracks:tr.mute=True
for tr in sk.animation_data.nla_tracks:tr.mute=True
rig.animation_data.action=clips[0];scene.frame_set(1)
from fbx_tools import export_paired_fbx
export_paired_fbx(OUT/'Skye_Animated.fbx',rig,sk)

stats={'blender_version':bpy.app.version_string,'mesh_objects':len([o for co in [CHAR,FUR] for o in co.objects if o.type=='MESH']),'vertices':sum(len(o.data.vertices) for co in [CHAR,FUR] for o in co.objects if o.type=='MESH'),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for co in [CHAR,FUR] for o in co.objects if o.type=='MESH'),'deform_bones':len([b for b in arm.bones if b.use_deform]),'control_bones':len([b for b in arm.bones if not b.use_deform]),'groom_strands':sum(o.get('strand_count',0) for o in FUR.objects),'morph_targets':[k.name for k in sk.key_blocks if k.name!='Basis'],'asset_version':'2.1','clips':[{'name':a.name,'frames':list(a.frame_range),'fps':30} for a in clips]}
(OUT/'model_info.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
print(json.dumps(stats),flush=True)
sk.animation_data.action=bpy.data.actions['Idle_Breathe_Face']
scene.camera=cam;scene.frame_set(1)
if '--no-render' not in sys.argv:
    from render_device import configure
    configure(scene)
    scene.render.filepath=str(OUT/'Skye_Preview.png');bpy.ops.render.render(write_still=True)
print('SKYE_BUILD_COMPLETE',flush=True)
