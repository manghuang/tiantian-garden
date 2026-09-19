"""Use an available Cycles accelerator without changing saved user preferences."""
import bpy,os
from pathlib import Path

def configure(scene):
    cache=Path(__file__).resolve().parents[1]/'.tools'/'optix-cache'
    cache.mkdir(parents=True,exist_ok=True)
    os.environ.setdefault('OPTIX_CACHE_PATH',str(cache))
    prefs=bpy.context.preferences.addons['cycles'].preferences
    for backend in ['OPTIX','CUDA','HIP','METAL','ONEAPI']:
        try:
            prefs.compute_device_type=backend;prefs.refresh_devices()
            devices=[d for d in prefs.devices if d.type==backend]
            if devices:
                for d in prefs.devices:d.use=d.type==backend
                scene.cycles.device='GPU'
                print('RENDER_DEVICE',backend,devices[0].name,flush=True)
                return backend
        except (TypeError,RuntimeError):continue
    scene.cycles.device='CPU';print('RENDER_DEVICE CPU',flush=True)
    return 'CPU'
