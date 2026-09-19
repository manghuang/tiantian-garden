"""Anatomical mouth, corneal highlights and eight coordinated eyelid morphs."""
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from types import SimpleNamespace
from math import sin, cos, pi, sqrt, exp

def build_face(env):
    e=SimpleNamespace(**env)
    def bind(o,b='head'):return e.weights(o,b)
    from mouth_system import build_mouth
    build_mouth(e)
    no=e.ellipsoid('Nose | supple leather',(0,-1.437,2.118),(.142,.084,.098),e.nosemat,64,40)
    for v in no.data.vertices:
        t=max(0,min(1,(2.139-v.co.z)/.128));v.co.x*=1-.43*t
    bind(no)
    # Portable micro relief: baked normal texture, not a render-only shader.
    n=256;yy,xx=np.mgrid[0:n,0:n]
    h=(np.sin(xx*.39+np.sin(yy*.37))*.4+np.sin(yy*.43+np.cos(xx*.29))*.4+np.sin(xx*.81+yy*.73)*.1)
    dx=np.roll(h,-1,axis=1)-np.roll(h,1,axis=1);dy=np.roll(h,-1,axis=0)-np.roll(h,1,axis=0)
    ar=np.stack([.5-.15*dx,.5-.15*dy,np.ones_like(h),np.ones_like(h)],-1)
    im=e.save_image('nose_micro_normal',ar,True)
    nt=e.nosemat.node_tree;tex=nt.nodes.new('ShaderNodeTexImage');tex.image=im
    normal=nt.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.26
    nt.links.new(tex.outputs['Color'],normal.inputs['Color']);nt.links.new(normal.outputs['Normal'],nt.nodes.get('Principled BSDF').inputs['Normal'])
    for s in [-1,1]:
        bind(e.ellipsoid('Nostril',(s*.068,-1.505,2.121),(.023,.004,.012),e.mouthmat,32,20))
    bind(e.curve('Philtrum',[(0,-1.447,2.036),(0,-1.443,2.005),(0,-1.431,1.989)],.004,e.nosemat,radii=[.9,.6,.04]))
    for s in [-1,1]:
        for i,(x,z) in enumerate([(.179,2.039),(.224,2.018),(.263,2.005)]):
            y=-1.421+(x-.16)*.58
            bind(e.ellipsoid('Muzzle follicle',(s*x,y,z),(.0035,.002,.0035),e.gold,12,8),e.muzzle_weights)
            if i==1:
                bind(e.curve('Fine whisker',[(s*x,y-.002,z),(s*(x+.037),y-.025,z+.011),(s*(x+.085),y-.038,z+.023)],.0008,e.cream,radii=[1,.55,.01]),e.muzzle_weights)
    head=e.head
    bvh=BVHTree.FromPolygons([v.co for v in head.data.vertices],[p.vertices for p in head.data.polygons])
    def front(x,z):
        hit=bvh.ray_cast(Vector((x,-2.6,z)),Vector((0,1,0)),4)
        return hit[0].y-.004 if hit[0] else -.96
    def shell(cx,cy,cz,rx,ry,rz,x,z):
        radial=1-(x/(rx+.015))**2-(z/(rz+.025))**2
        return cy-(ry+.008)*sqrt(max(.00001,radial))-.010,radial
    def lid_surface(cx,cy,cz,rx,ry,rz,u,v,outer,z):
        # The whole lid must sit outside the convex eyeball. Interpolating from
        # the head to only the lash edge sinks the middle of a closed lid inside it.
        x=(rx+.047*(1-v))*u
        cornea,radial=shell(cx,cy,cz,rx,ry,rz,x,z)
        scalp=front(cx+(rx+.047)*u,cz+outer)
        blended=scalp*(1-v)+cornea*v
        return min(blended,cornea) if radial>=0 else blended
    verts=[];faces=[];mats=[];meta=[]
    params={}
    def append(o,si,kind):
        off=len(verts)
        verts.extend(v.co.copy() for v in o.data.vertices)
        meta.extend([(si,kind,None)]*len(o.data.vertices))
        faces.extend(tuple(off+i for i in p.vertices) for p in o.data.polygons);mats.extend([1]*len(o.data.polygons))
        bpy.data.objects.remove(o,do_unlink=True)
    for s,si in [(1,'L'),(-1,'R')]:
        cx=s*.268;cy=-1.083;cz=2.415;rx=.215;rz=.262;ry=.147
        params[si]=(cx,cy,cz,rx,ry,rz,s)
        # Clearance for oblique views and the small rotations used by gaze animation.
        bind(e.ellipsoid('Eye white.'+si,(cx,cy,cz),(.972*rx,.98*ry,.960*rz),e.white,80,52),'eye.'+si)
        iv=[(cx,cy-ry-.006,cz)];uvs=[(.5,.5)];ifs=[];ns=112;nr=15
        for k in range(1,nr+1):
            r=k/nr
            for j in range(ns):
                a=2*pi*j/ns;x=.119*r*cos(a);z=.145*r*sin(a)
                y=cy-ry*sqrt(max(.001,1-(x/rx)**2-(z/rz)**2))-.006
                iv.append((cx+x,y,cz+z));uvs.append((.5+.5*r*cos(a),.5+.5*r*sin(a)))
        for j in range(ns):ifs.append((0,1+j,1+(j+1)%ns))
        for k in range(nr-1):
            for j in range(ns):
                a=1+k*ns+j;b=1+k*ns+(j+1)%ns;ifs.append((a,a+ns,b+ns,b))
        iris=e.mesh('Iris | wet radial fibres.'+si,iv,ifs,e.irismat);uv=iris.data.uv_layers.new(name='UVMap')
        for p in iris.data.polygons:
            for li in p.loop_indices:uv.data[li].uv=uvs[iris.data.loops[li].vertex_index]
        bind(iris,'eye.'+si)
        # Upper and lower bands blend from the actual head surface to the eye.
        for upper in [True,False]:
            off=len(verts);nu=64;nv=28
            for j in range(nv):
                v=j/(nv-1)
                for i in range(nu+1):
                    u=-1+2*i/nu;sh=sqrt(max(0,1-u*u))
                    edge=(.223 if upper else -.185)*sh+.019*s*u
                    outer=(.326 if upper else -.316)*sh+.019*s*u
                    z=outer*(1-v)+edge*v;x=cx+(rx+.047*(1-v))*u
                    y=lid_surface(cx,cy,cz,rx,ry,rz,u,v,outer,z)
                    verts.append(Vector((x,y,cz+z)));meta.append((si,'upper' if upper else 'lower',(u,v,outer,edge)))
            for j in range(nv-1):
                for i in range(nu):
                    a=off+j*(nu+1)+i;faces.append((a,a+1,a+nu+2,a+nu+1));mats.append(0)
        upperpts=[]
        for u in np.linspace(-.96,.98,29):
            sh=sqrt(1-u*u);z=.223*sh+.019*s*u
            y=shell(cx,cy,cz,rx,ry,rz,rx*u,z)[0]-.006
            upperpts.append((cx+rx*u,y,cz+z))
        append(e.curve('Upper lash line.'+si,upperpts,.0068,e.lashmat,radii=[.15]+[1]*27+[.15]),si,'rim')
        for k,u0 in enumerate([.60,.73,.83,.91]):
            u=s*u0;sh=sqrt(1-u*u);z=.223*sh+.019*s*u
            y=shell(cx,cy,cz,rx,ry,rz,rx*u,z)[0]-.008;x=cx+rx*u
            pts=[(x,y,cz+z),(x+s*.025,y-.012,cz+z+.019),(x+s*(.045+.004*k),y-.020,cz+z+.048)]
            append(e.curve('Lash fan.'+si,pts,.0065,e.lashmat,radii=[1,.57,.015]),si,'lash')
        # Movable eyebrows with a soft hair edge, rather than rigid triangles.
        pts=[(s*.155,-1.074,2.742),(s*.232,-1.104,2.767),(s*.323,-1.059,2.735)]
        bind(e.curve('Brow | sculpted.'+si,pts,.015,e.lashmat,radii=[.08,1,.06]),'brow.'+si)
        for k in range(20):
            u=k/19;x=s*(.162+.154*u);z=2.743+.020*sin(pi*u);y=-1.078-.022*sin(pi*u)
            bind(e.curve('Brow | fine hairs.'+si,[(x,y,z),(x+s*.011,y-.006,z+.013),(x+s*.020,y-.005,z+.017)],.00085,e.lashmat,radii=[.55,1,.02]),'brow.'+si)
    lids=e.mesh('Upper_lids | Blink shape key',verts,faces,e.skinmat)
    lids.data.materials.append(e.lashmat)
    for p,mi in zip(lids.data.polygons,mats):p.material_index=mi
    at=lids.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
    at.data.foreach_set('color',np.array([(*e.head_color(v),1) for v in verts],dtype=np.float32).ravel())
    bind(lids);lids.shape_key_add(name='Basis')
    def target(index,b=0,q=0,w=0):
        p=verts[index];si,kind,data=meta[index];cx,cy,cz,rx,ry,rz,s=params[si]
        if kind in ['upper','lower']:
            u,v,outer,edge=data;sh=sqrt(max(0,1-u*u))
            if kind=='upper':edge=edge*(1-b)+(-.185*sh+.019*s*u)*b+.038*w*sh-.030*q*sh
            else:edge+=.075*q*sh
            z=outer*(1-v)+edge*v
            y=lid_surface(cx,cy,cz,rx,ry,rz,u,v,outer,z)
            return Vector((p.x,y,cz+z))
        u=max(-.99,min(.99,(p.x-cx)/rx));sh=sqrt(1-u*u)
        dz=-.408*sh*b+.038*sh*w-.030*sh*q
        z=p.z-cz+dz
        if kind=='rim':
            y=shell(cx,cy,cz,rx,ry,rz,rx*u,z)[0]-.008
        else:
            oldz=.223*sh+.019*s*u;newz=oldz+dz
            oldy=shell(cx,cy,cz,rx,ry,rz,rx*u,oldz)[0]
            newy=shell(cx,cy,cz,rx,ry,rz,rx*u,newz)[0]
            y=p.y+newy-oldy
        return Vector((p.x,y,cz+z))
    for si in ['L','R']:
        for kind in ['Blink','BlinkArc','Squint','Wide']:
            key=lids.shape_key_add(name=kind+'.'+si)
            for i,pt in enumerate(key.data):
                if meta[i][0]!=si:continue
                if kind=='Blink':pt.co=target(i,b=1)
                elif kind=='BlinkArc':pt.co=verts[i]+target(i,b=.5)-(verts[i]+target(i,b=1))*.5
                elif kind=='Squint':pt.co=target(i,q=1)
                elif kind=='Wide':pt.co=target(i,w=1)
    lids['Expression_notes']='BlinkArc is a corneal-path corrective: 4 * Blink * (1 - Blink). The supplied action library and Skye sidebar synchronize it automatically.'
    return lids
