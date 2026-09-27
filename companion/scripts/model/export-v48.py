"""Export the reviewed v48 Blender candidate as a self-contained animated GLB.

Run with the repository's Blender executable. The source .blend remains untouched.
"""

from pathlib import Path
import bpy
import sys


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "output" / "Skye_Refined_v48" / "Skye_Refined_v48_expressive_candidate_r2.blend"
OUTPUT = ROOT / "output" / "Skye_Refined_v48" / "export" / "Skye_Refined_v48_r2.glb"

if not SOURCE.is_file():
    raise FileNotFoundError(SOURCE)
if bpy.data.filepath and Path(bpy.data.filepath).resolve() != SOURCE.resolve():
    raise RuntimeError(f"Loaded Blender file does not match reviewed candidate: {bpy.data.filepath}")

# The app viewport is about 500 px wide. 1K maps retain visible facial and fur
# detail there while keeping the deployable model smaller than the 4K source.
for image in bpy.data.images:
    if image.name == "Render Result" or image.size[0] == 0 or image.size[1] == 0:
        continue
    max_dimension = max(image.size)
    if max_dimension > 1024:
        scale = 1024 / max_dimension
        image.scale(max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
        image.pack()

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for obj in bpy.data.objects:
    if obj.type == "ARMATURE" or (obj.type == "MESH" and obj.name != "Foot controller"):
        obj.select_set(True)
rig = bpy.data.objects.get("Reference_Model_Rig")
if not rig:
    raise RuntimeError("Reference_Model_Rig was not found")
bpy.context.view_layer.objects.active = rig

actions = sorted(action.name for action in bpy.data.actions)
if len(actions) < 20:
    raise RuntimeError(f"Expected the expressive animation library, found {len(actions)} actions")

bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_anim_slide_to_zero=True,
    export_def_bones=True,
    export_force_sampling=True,
    export_tangents=True,
    export_morph=True,
    export_morph_animation=True,
    export_skins=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_extras=True,
)
sys.path.insert(0, str(ROOT / "scripts"))
from gltf_tools import root_skinned_meshes
root_skinned_meshes(OUTPUT)
print("V48_EXPORT", OUTPUT, OUTPUT.stat().st_size, "bytes", len(actions), "source actions", flush=True)
