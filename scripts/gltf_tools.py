"""Small standards-preserving cleanup for Blender's glTF scene hierarchy."""
import json,struct
import numpy as np
from pathlib import Path

def root_skinned_meshes(path):
    path=Path(path);blob=path.read_bytes()
    size=struct.unpack_from('<I',blob,12)[0]
    doc=json.loads(blob[20:20+size])
    binlen,bintype=struct.unpack_from('<II',blob,20+size)
    binary=bytearray(blob[28+size:28+size+binlen])
    skinned={i for i,n in enumerate(doc['nodes']) if 'skin' in n}
    parents={c:i for i,n in enumerate(doc['nodes']) for c in n.get('children',[])}
    for i in skinned:
        # Authored rig object has no transform. Assert before changing parents.
        p=parents.get(i)
        if p is not None:
            par=doc['nodes'][p]
            assert all(k not in par for k in ['matrix','translation','rotation','scale'])
            par['children'].remove(i)
        for scene in doc['scenes']:
            if p in scene['nodes'] and i not in scene['nodes']:scene['nodes'].append(i)
    for n in doc['nodes']:
        if 'children' in n and not n['children']:del n['children']
    def read(idx):
        a=doc['accessors'][idx];v=doc['bufferViews'][a['bufferView']]
        dt=np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']])
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        return np.ndarray((a['count'],n),dtype=dt,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',n*dt.itemsize),dt.itemsize)).copy()
    for m in doc['meshes']:
        for p in m['primitives']:
            at=p['attributes'];mat=doc['materials'][p['material']]
            pbr=mat.get('pbrMetallicRoughness',{})
            textured=any(k in mat for k in ['normalTexture','occlusionTexture','emissiveTexture']) or any(k in pbr for k in ['baseColorTexture','metallicRoughnessTexture'])
            if not textured:
                for k in list(at):
                    if k.startswith('TEXCOORD_'):del at[k]
            if 'normalTexture' not in mat:
                at.pop('TANGENT',None)
                continue
            normals=read(at['NORMAL'])
            if 'TANGENT' in at:
                t=read(at['TANGENT']);tangent=t[:,:3].copy();hand=t[:,3].copy()
            else:
                pos=read(at['POSITION']);uv=read(at['TEXCOORD_0']);ix=read(p['indices']).reshape((-1,3))
                e1=pos[ix[:,1]]-pos[ix[:,0]];e2=pos[ix[:,2]]-pos[ix[:,0]]
                d1=uv[ix[:,1]]-uv[ix[:,0]];d2=uv[ix[:,2]]-uv[ix[:,0]]
                det=d1[:,0]*d2[:,1]-d1[:,1]*d2[:,0];safe=np.where(abs(det)>1e-10,1/np.where(abs(det)>1e-10,det,1),0)
                ta=(e1*d2[:,1,None]-e2*d1[:,1,None])*safe[:,None]
                bi=(e2*d1[:,0,None]-e1*d2[:,0,None])*safe[:,None]
                tangent=np.zeros_like(pos);bitangent=np.zeros_like(pos)
                for j in range(3):np.add.at(tangent,ix[:,j],ta);np.add.at(bitangent,ix[:,j],bi)
                hand=np.where(np.sum(np.cross(normals,tangent)*bitangent,axis=1)<0,-1,1)
            tangent-=normals*np.sum(normals*tangent,axis=1)[:,None]
            lengths=np.linalg.norm(tangent,axis=1);bad=lengths<1e-6
            if np.any(bad):
                basis=np.tile([0,1,0],(int(bad.sum()),1));nb=normals[bad]
                basis[abs(nb[:,1])>.9]=[1,0,0]
                tangent[bad]=np.cross(nb,basis)
            tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-20)
            packed=np.column_stack([tangent,np.where(hand<0,-1.,1.)]).astype('<f4')
            binary+=b'\x00'*((-len(binary))%4);off=len(binary);binary.extend(packed.tobytes())
            bv=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':packed.nbytes,'target':34962})
            ac=len(doc['accessors']);doc['accessors'].append({'bufferView':bv,'componentType':5126,'count':len(packed),'type':'VEC4'})
            at['TANGENT']=ac
    # Compact unused attribute payloads after removing unnecessary UVs/tangents.
    used=set()
    for m in doc['meshes']:
        for p in m['primitives']:
            used.update(p['attributes'].values())
            if 'indices' in p:used.add(p['indices'])
            for target in p.get('targets',[]):used.update(target.values())
    for skin in doc['skins']:
        if 'inverseBindMatrices' in skin:used.add(skin['inverseBindMatrices'])
    for a in doc.get('animations',[]):
        for s in a['samplers']:used.update([s['input'],s['output']])
    amap={a:i for i,a in enumerate(sorted(used))}
    usedviews={im['bufferView'] for im in doc.get('images',[]) if 'bufferView' in im}
    for i in used:
        a=doc['accessors'][i]
        if 'bufferView' in a:usedviews.add(a['bufferView'])
        if 'sparse' in a:
            for k in ['indices','values']:usedviews.add(a['sparse'][k]['bufferView'])
    vmap={v:i for i,v in enumerate(sorted(usedviews))};newbinary=bytearray();views=[]
    for i in sorted(usedviews):
        v=doc['bufferViews'][i].copy();newbinary+=b'\x00'*((-len(newbinary))%4)
        offset=v.get('byteOffset',0);v['byteOffset']=len(newbinary)
        newbinary+=binary[offset:offset+v['byteLength']];views.append(v)
    accessors=[]
    for i in sorted(used):
        a=doc['accessors'][i]
        if 'bufferView' in a:a['bufferView']=vmap[a['bufferView']]
        if 'sparse' in a:
            for k in ['indices','values']:a['sparse'][k]['bufferView']=vmap[a['sparse'][k]['bufferView']]
        accessors.append(a)
    for m in doc['meshes']:
        for p in m['primitives']:
            p['attributes']={k:amap[v] for k,v in p['attributes'].items()}
            if 'indices' in p:p['indices']=amap[p['indices']]
            for target in p.get('targets',[]):
                for k in target:target[k]=amap[target[k]]
    for skin in doc['skins']:
        if 'inverseBindMatrices' in skin:skin['inverseBindMatrices']=amap[skin['inverseBindMatrices']]
    for a in doc.get('animations',[]):
        for s in a['samplers']:s['input']=amap[s['input']];s['output']=amap[s['output']]
    for im in doc.get('images',[]):
        if 'bufferView' in im:im['bufferView']=vmap[im['bufferView']]
    doc['accessors']=accessors;doc['bufferViews']=views;doc['buffers'][0]['byteLength']=len(newbinary)
    newbinary+=b'\x00'*((-len(newbinary))%4)
    tail=struct.pack('<II',len(newbinary),bintype)+newbinary
    content=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    content+=b' '*((-len(content))%4)
    total=12+8+len(content)+len(tail)
    path.write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(content),0x4e4f534a)+content+tail)
