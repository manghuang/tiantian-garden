"""Run the pinned local model on loopback without printing dialogue text."""
import os
from pathlib import Path
import runpy
import sys

workspace = Path(__file__).resolve().parents[2]
model = workspace / '.tools' / 'GPT-SoVITS'
os.chdir(model)
os.environ['PATH'] = str(model) + os.pathsep + os.environ.get('PATH', '')
os.environ['NLTK_DATA'] = str(workspace / '.tools' / 'nltk_data')
os.environ['HF_HOME'] = str(workspace / '.tools' / 'huggingface')
os.environ['MPLCONFIGDIR'] = str(workspace / '.tools' / 'matplotlib')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['GRADIO_ANALYTICS_ENABLED'] = 'False'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
sys.path.insert(0, str(model))
runtime = workspace / '.tools' / 'voice-runtime'
runtime.mkdir(parents=True, exist_ok=True)
runtime_config = runtime / 'tts.yaml'
runtime_config.write_bytes((workspace / 'companion/local-voice/tts.yaml').read_bytes())
sys.argv = ['api_v2.py', '-a', '127.0.0.1', '-p', '9880', '-c', str(runtime_config)]
# GPT-SoVITS prints input/normalized text during inference. Do not persist it.
with open(os.devnull, 'w', encoding='utf-8') as quiet:
    sys.stdout = quiet
    api = runpy.run_path(str(model / 'api_v2.py'), run_name='tiantian_local_api')
    app = api['APP']
    # Keep only synthesis. The stock API also has process-control and arbitrary
    # weight-switch endpoints, which this demonstration does not need.
    app.router.routes = [route for route in app.router.routes
                         if route.path == '/tts' and 'POST' in (getattr(route, 'methods', None) or [])]

    @app.get('/health')
    async def health():
        import torch
        return {'service': 'tiantian-local-voice', 'workspace': str(workspace),
                'model': 'v2ProPlus', 'cuda': torch.cuda.is_available(), 'pid': os.getpid()}

    @app.middleware('http')
    async def local_clients_only(request, call_next):
        from fastapi.responses import JSONResponse
        if request.headers.get('origin') or request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse(status_code=403, content={'error': 'Local application clients only'})
        return await call_next(request)

    import uvicorn
    uvicorn.run(app=app, host='127.0.0.1', port=9880, workers=1, access_log=False)
