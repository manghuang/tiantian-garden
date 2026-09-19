"""A sealed resting mouth with an articulated jaw, soft corners and oral depth."""
import math,bmesh
import numpy as np
from mathutils import Vector,Euler
from math import sin,cos,pi,sqrt

MAX_JAW_OPEN=.46
WIDTH=.288

def seam_z(x):
    return 2.045-.184*sqrt(max(.05,1-(x/.36)**2))+.018

def seam_y(x):
    z=seam_z(x)
    return -1.209-.230*sqrt(max(.005,1-(x/.36)**2-((z-2.045)/.184)**2))-.006

def set_open(rig,value):
    value=max(0,min(1,value));pb=rig.pose.bones['jaw']
    rest=pb.bone.matrix_local.to_quaternion()
    pb.rotation_quaternion=rest.inverted()@Euler((MAX_JAW_OPEN*value,0,0),'XYZ').to_quaternion()@rest

def get_open(rig):
    pb=rig.pose.bones['jaw'];rest=pb.bone.matrix_local.to_quaternion()
    return max(0,min(1,(rest@pb.rotation_quaternion@rest.inverted()).to_euler('XYZ').x/MAX_JAW_OPEN))

def build_mouth(e):
    def bind(obj,fn='head',part='external'):
        obj['Mouth_part']=part;return e.weights(obj,fn)
    def lip_weights(p,lower=False):
        u=min(1,abs(p.x)/WIDTH);corner=.78*u**4
        jaw=sqrt(max(0,1-u*u)) if lower else 0
        return {'head':(1-corner)*(1-jaw),'jaw':(1-corner)*jaw,
                'lip_corner.'+('L' if p.x>0 else 'R'):corner}
    def indexed_skin(obj,weights):
        bind(obj,'head')
        for vg in list(obj.vertex_groups):obj.vertex_groups.remove(vg)
        groups={name:obj.vertex_groups.new(name=name) for name in ['head','jaw','lip_corner.L','lip_corner.R']}
        for i,w in enumerate(weights):
            for name,value in w.items():
                if value>0:groups[name].add([i],value,'REPLACE')
    lipmat=e.material('Lips | fine warm umber edge','715047',.59,subsurface=.045)
    gum=e.material('Mouth | warm gingiva','773E48',.53,subsurface=.07)
    tissue=e.material('Mouth | recessed oral tissue','49232D',.61,subsurface=.04)
    # Lip surfaces meet in the neutral pose; lower rings follow the mandibular arc.
    for lower in [False,True]:
        vv=[];ff=[];nu=72;ns=12;seal=[]
        for i in range(nu+1):
            u=-1+2*i/nu;x=WIDTH*u;r=.0046*(.7+.3*sqrt(max(0,1-u*u)))
            z=seam_z(x)+(-.0026 if lower else .0026)
            for j in range(ns):
                a=2*pi*j/ns;vv.append((x,seam_y(x)+r*cos(a),z+r*sin(a)))
            seal.append(i*ns+(ns//4 if lower else 3*ns//4))
        for i in range(nu):
            for j in range(ns):
                a=i*ns+j;b=i*ns+(j+1)%ns;ff.append((a,b,b+ns,a+ns))
        ff.append(tuple(range(ns-1,-1,-1)));ff.append(tuple(range(nu*ns,(nu+1)*ns)))
        obj=e.mesh('Mouth | lower lip seal' if lower else 'Mouth | upper lip seal',vv,ff,lipmat)
        obj['seal_indices']=seal
        bind(obj,lambda p,lo=lower:lip_weights(p,lo))
    # Rounded chin rolls back into the cheeks and underside, without an exposed shelf.
    vv=[];ff=[];chin_weights=[];nu=72;nv=24
    for j in range(nv):
        v=j/(nv-1);a=v*pi*.78
        for i in range(nu+1):
            u=-1+2*i/nu;sh=sqrt(max(0,1-u*u));x=WIDTH*u
            vv.append((x*(1-.12*sin(a)**2),seam_y(x)+.137*(1-cos(a)),
                       seam_z(x)-.005-.085*sh*sin(a)-.014*v))
            mix=min(1,v/.28);mix=mix*mix*(3-2*mix)
            w={name:value*(1-mix) for name,value in lip_weights(Vector(vv[-1]),True).items()}
            w['jaw']=w.get('jaw',0)+mix;chin_weights.append(w)
    for j in range(nv-1):
        for i in range(nu):
            a=j*(nu+1)+i;ff.append((a,a+nu+1,a+nu+2,a+1))
    # Cheek bridges close the lateral shell, with a fixed attachment inside the head.
    # The mandibular edge moves freely while the rear cheek stretches smoothly.
    for side,edge in [(-1,0),(1,nu)]:
        off=len(vv);cols=12
        for j in range(nv):
            v=j/(nv-1);idx=j*(nu+1)+edge;start=Vector(vv[idx])
            anchor=Vector((side*.382,-1.035+.065*v,seam_z(WIDTH)+.062-.076*v))
            for k in range(cols+1):
                t=k/cols;p=start.lerp(anchor,t)
                p.x+=side*.018*sin(pi*t)*sin(pi*v);vv.append(tuple(p))
                w={name:value*(1-t) for name,value in chin_weights[idx].items()}
                for name,value in e.head_weights(anchor).items():w[name]=w.get(name,0)+t*value
                chin_weights.append(w)
        for j in range(nv-1):
            for k in range(cols):
                a=off+j*(cols+1)+k;face=(a,a+1,a+cols+2,a+cols+1)
                ff.append(face if side>0 else face[::-1])
    back=len(vv);vv.append((0,-.98,1.87))
    chin_weights.append({'jaw':1})
    for i in range(nu):ff.append((back,(nv-1)*(nu+1)+i+1,(nv-1)*(nu+1)+i))
    chin=e.mesh('Jaw | rounded soft chin',vv,ff,e.cream)
    indexed_skin(chin,chin_weights)
    bm=bmesh.new();bm.from_mesh(chin.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(chin.data);bm.free()
    sub=chin.modifiers.new('Continuous cheek and chin surface','SUBSURF');sub.levels=2;e.apply(chin,sub)
    e.coat(chin,lambda p:e.blend(e.PALE,e.head_color(p),max(0,min(1,(abs(p.x)-.27)/.11))))
    # A narrow entrance seals at rest, but the volume behind it remains deep.
    vv=[];ff=[];weights=[];n=96;nr=9
    for k in range(nr):
        t=k/(nr-1);radius=1-.40*t
        for j in range(n):
            a=2*pi*j/n;u=cos(a);x=WIDTH*u*radius
            z=seam_z(WIDTH*u)*(1-t)+1.884*t + sin(a)*(.006*(1-t)+.060*sin(pi*t)+.032*t)
            y=(seam_y(WIDTH*u)+.013)*(1-t)-1.164*t
            vv.append((x,y,z))
            w=lip_weights(Vector((WIDTH*u,y,z)),sin(a)<0)
            mix=min(1,t/.28);mix=mix*mix*(3-2*mix)
            inner_jaw=.5-.5*sin(a)
            w={name:value*(1-mix) for name,value in w.items()}
            w['head']=w.get('head',0)+(1-inner_jaw)*mix
            w['jaw']=w.get('jaw',0)+inner_jaw*mix
            weights.append(w)
    for k in range(nr-1):
        for j in range(n):
            a=k*n+j;b=k*n+(j+1)%n;ff.append((a,b,b+n,a+n))
    ff.append(tuple(range((nr-1)*n,nr*n)))
    cavity=e.mesh('Mouth | continuous palate and floor',vv,ff,tissue)
    # Mesh vertices are float32, so indexed assignment preserves the exact authored weights.
    indexed_skin(cavity,weights);cavity['Mouth_part']='interior'
    # Teeth sit behind the lip, with their roots embedded in a continuous gum ridge.
    for lower in [False,True]:
        pts=[]
        for x in np.linspace(-.20,.20,25):
            pts.append((x,seam_y(x)+.048,seam_z(x)+(-.017 if lower else .020)))
        bind(e.curve('Mouth | lower gum' if lower else 'Mouth | upper gum',pts,.011,gum),
             'jaw' if lower else 'head',part='interior')
        for i,x in enumerate(np.linspace(-.087,.087,6)):
            z=seam_z(x)+(-.026 if lower else -.001)
            tooth=e.ellipsoid(('Lower' if lower else 'Upper')+' incisor %02d'%i,
                (x,seam_y(x)+(.047 if lower else .028),z),(.0115,.009,.009 if lower else .021),e.toothmat,24,18)
            bind(tooth,'jaw' if lower else 'head',part='interior')
    for s in [-1,1]:
        x=s*.188;y=seam_y(x)+.047;z=seam_z(x)+.029
        tooth=e.tube('Upper canine',[(x,y,z),(x,y-.001,z-.019),(x-s*.004,y-.004,z-.040)],
                     [.012,.010,.0015],e.toothmat,sides=16,subdiv=2)
        bind(tooth,'head',part='interior')
    # Broad, slightly cupped tongue; its tip stays behind the closed lips.
    tongue=e.ellipsoid('Tongue | soft articulated body',(0,-1.185,1.858),(.118,.112,.026),e.tonguemat,64,32)
    for v in tongue.data.vertices:
        v.co.z+=.004*(abs(v.co.x)/.118)**2
    bind(tongue,'tongue',part='interior')
    crease=e.material('Tongue | shallow median sulcus','A75C6A',.60)
    bind(e.curve('Tongue | delicate center groove',[(0,-1.17,1.884),(0,-1.23,1.884),(0,-1.279,1.873)],
                 .0013,crease,radii=[.05,.7,.03]),'tongue',part='interior')
    for s,si in [(1,'L'),(-1,'R')]:
        x=s*WIDTH
        pts=[(x,seam_y(x)-.001,seam_z(x)),(s*.316,seam_y(x)+.023,seam_z(x)+.027),
             (s*.334,seam_y(x)+.045,seam_z(x)+.055)]
        bind(e.curve('Mouth | soft corner crease.'+si,pts,.0035,lipmat,radii=[.8,.6,.02]),
             lambda p:lip_weights(p,False))
    e.rig['Mouth_control']='Closed bind pose. Jaw opening 0..1 maps to 0..0.46 radians about the jaw hinge. Use Skye sidebar.'
    e.rig['Jaw_open_max_radians']=MAX_JAW_OPEN
