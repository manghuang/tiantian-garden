"""Require passing delivery checks, record hashes, and rebuild the portable ZIP."""
import hashlib,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output'
def read(name):return json.loads((OUT/name).read_text(encoding='utf-8-sig'))
for name in ['motion_validation.json','ui_validation.json','fbx_validation.json','video_validation.json','mouth_validation.json']:
    assert read(name)['passed'],name
issues=read('khronos_validation.json')['issues']
assert issues['numErrors']==0 and issues['numWarnings']==0
assert read('roundtrip_validation.json')['imported_bones']==40
assert len(read('animation_catalog.json'))==11
assert read('validation.json')['passed']
required=['Skye_Rigged.blend','Skye_Animated.glb','Skye_Animated.fbx','Skye_Animation_Demo.mp4','Skye_Preview.png','Skye_Expressions.jpg','Skye_Mouth_Demo.mp4','Skye_Mouth_States.jpg']
files=[]
for name in required:
    p=OUT/name
    files.append({'file':'output/'+name,'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()})
manifest={'asset_version':'2.1','baseline_git_commit':'012c326','files':files,'deform_bones':40,'control_bones':8,'eyelid_morph_targets':8,'animation_clips':11,'jaw_open_range':[0,1],'khronos_errors':0,'khronos_warnings':0}
(OUT/'delivery_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
include=[ROOT/'README.md',ROOT/'Open_Skye.cmd']
for folder in ['scripts','references','output']:
    for p in sorted((ROOT/folder).rglob('*')):
        if not p.is_file() or any(part in {'__pycache__','frames'} for part in p.parts):continue
        if p.suffix in {'.blend1','.pyc'} or p.name=='video_check.png':continue
        include.append(p)
archive=ROOT/'archives'/'Skye_3D_Package.zip'
archive.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in include:z.write(p,p.relative_to(ROOT).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert len(z.namelist())==len(include)
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(include),'verified':True},ensure_ascii=False))
