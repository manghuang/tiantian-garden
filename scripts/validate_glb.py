"""Check the delivered binary asset, including skinning and animation payloads."""
import json, struct
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'output'/'Skye_Animated.glb'
data=p.read_bytes()
magic,version,size=struct.unpack_from('<III',data)
assert magic==0x46546c67 and version==2 and size==len(data)
jl,jt=struct.unpack_from('<II',data,12)
g=json.loads(data[20:20+jl])
bl,bt=struct.unpack_from('<II',data,20+jl)
binary=data[28+jl:28+jl+bl]
dtype={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
dim={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16,'MAT3':9,'MAT2':4}
def accessor(idx):
    a=g['accessors'][idx]
    dt=np.dtype(dtype[a['componentType']]);n=dim[a['type']]
    if 'bufferView' in a:
        v=g['bufferViews'][a['bufferView']]
        off=v.get('byteOffset',0)+a.get('byteOffset',0)
        stride=v.get('byteStride',n*dt.itemsize)
        out=np.ndarray(shape=(a['count'],n),dtype=dt,buffer=binary,offset=off,strides=(stride,dt.itemsize)).copy()
    else:out=np.zeros((a['count'],n),dtype=dt)
    if 'sparse' in a:
        sp=a['sparse'];ix=sp['indices'];va=sp['values']
        iv=g['bufferViews'][ix['bufferView']];vv=g['bufferViews'][va['bufferView']]
        indices=np.frombuffer(binary,dtype=dtype[ix['componentType']],count=sp['count'],offset=iv.get('byteOffset',0)+ix.get('byteOffset',0))
        values=np.frombuffer(binary,dtype=dt,count=sp['count']*n,offset=vv.get('byteOffset',0)+va.get('byteOffset',0)).reshape((-1,n))
        out[indices]=values
    if a.get('normalized'):
        out=out.astype(np.float32)/np.iinfo(dt).max
    return out
checks=[]
for i,a in enumerate(g['accessors']):
    ar=accessor(i)
    assert np.isfinite(ar).all(),f'Non-finite values in accessor {i}'
checks.append('All geometry, joint matrices, UVs, morphs and animation samples are finite.')
max_weight_error=0;vertices=0
for node in g['nodes']:
    if 'mesh' not in node:continue
    assert 'skin' in node,f'Unskinned mesh: {node.get("name")}'
    joint_count=len(g['skins'][node['skin']]['joints'])
    for prim in g['meshes'][node['mesh']]['primitives']:
        at=prim['attributes'];assert 'POSITION'in at and 'JOINTS_0'in at and 'WEIGHTS_0'in at
        pos=accessor(at['POSITION']);j=accessor(at['JOINTS_0']);w=accessor(at['WEIGHTS_0'])
        assert j.max()<joint_count and j.min()>=0
        error=float(np.abs(w.sum(axis=1)-1).max());max_weight_error=max(max_weight_error,error)
        assert error<1e-4 and w.min()>=0
        if 'indices' in prim:assert accessor(prim['indices']).max()<len(pos)
        vertices+=len(pos)
checks.append('Every exported mesh is skinned; joint references and normalized weights are valid.')
anims=[]
for anim in g.get('animations',[]):
    moving=[];duration=0;bone_channels=0;morph_channels=0
    for ch in anim['channels']:
        sa=anim['samplers'][ch['sampler']];t=accessor(sa['input']).ravel();v=accessor(sa['output'])
        assert np.all(np.diff(t)>0)
        duration=max(duration,float(t[-1]));path=ch['target']['path']
        if path=='weights':morph_channels+=1
        else:bone_channels+=1
        if float(np.ptp(v,axis=0).max())>1e-4:moving.append(g['nodes'][ch['target']['node']].get('name','unnamed')+':'+path)
    assert bone_channels>0 and morph_channels>0 and len(moving)>5
    anims.append({'name':anim['name'],'duration_seconds':round(duration,4),'bone_channels':bone_channels,'morph_channels':morph_channels,'changing_channels':len(moving)})
assert {a['name'] for a in anims}=={'Idle_Breathe','Walk','Happy_Tail','Takeoff_Hover'}
checks.append('All four animations include sampled bone movement and a blinking morph channel.')
assert all('uri' not in im for im in g.get('images',[]))
checks.append('All textures are embedded; the GLB has no external image dependencies.')
report={'passed':True,'file':p.name,'size_bytes':len(data),'exported_vertices_including_uv_splits':vertices,'joint_count':len(g['skins'][0]['joints']),'max_weight_sum_error':max_weight_error,'animations':anims,'checks':checks}
(ROOT/'output'/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
