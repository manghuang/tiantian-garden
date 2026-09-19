# 本机角色语音

用户选择使用本机 RTX 4060 Ti。模型在 `127.0.0.1:9880` 运行，Node 桥接主动连接线上 Durable Object。外网只能提交受控对话，不能调用模型的控制、权重切换或参考文件接口。

2026-09-17 已实际生成三个新台词试听，并通过线上中文识别 → DeepSeek → GPU 音频返回、取消及下一轮恢复。当前使用从节目中重新切出的天天对白；最初包含另一角色的候选已排除。声音是否与原版一致仍需用户试听，不能由链路通过或转写结果证明。

## 本机文件

- `.tools/voice-venv`：独立 Python 3.11 环境，CUDA PyTorch / torchaudio 2.6.0、ONNX Runtime GPU 1.20.2。`pip check` 通过，固定版本见 `requirements.windows.lock.txt`。
- `.tools/GPT-SoVITS`：官方仓库提交 `48b1a0169a28582a8984402f82cf438d3bfa6aca`。
- `download-manifest.json`、`resources-manifest.json` 位于模型目录，记录固定版本与权重校验。
- `companion/.env.voice.local`：参考音频、转写、线上地址和独立 worker 密钥；不进入版本控制，不提供给浏览器。
- `companion/local-voice/tts.yaml`：固定 v2ProPlus、半精度 CUDA 配置。

## 运行与试听

双击项目根目录 `Start_Local_Voice.cmd`，等待显示 `Local character voice connected`，再打开线上花园并选择 DeepSeek。保持窗口和电脑运行；Ctrl+C 停止本次启动的桥接与模型。已运行时脚本会识别对应进程，避免重复连接。模型只监听本机；包装层仅保留 POST `/tts` 与 GET `/health`，移除了进程控制、权重切换和 GET 合成接口。

2026-09-17 针对机械感调整了参考与断句：参考改为两个画面确认只有天天的连续片段“我来救我来救／太好了，我钩住了”（约 3.7 秒有效声音，满足模型 3 秒最短参考要求，尾部只补静音），不再使用此前含另一角色对白的组合；140 字以内的儿童短回答采用整句 `cut0` 推理，较长回答才按标点切分。温度 0.7、语速 1.0。已验证冷启动、固定开场白预热、线上连接以及重复启动识别。Windows Path/PATH 重名问题在启动器自身环境中处理；运行配置写入 `.tools/voice-runtime/tts.yaml`，避免模型库改写仓库配置。页面选择 GPU 音色后隐藏旧演示配音试听，固定音色暂不应用明亮 / 温柔选项；保存后开始互动可听到模型的真实回答。

也可单独运行 `.tools/voice-venv/Scripts/python.exe companion/local-voice/run_api.py`，再在 `companion` 目录运行 `node scripts/local-voice-worker.mjs`。初次加载需要等待；桥接会预热开场白后连接线上。

已有 `.env.voice.local` 配置，不要覆盖。新环境可按 `.env.voice.example` 创建，并运行 `node scripts/init-local-voice.mjs` 生成独立密钥，再使用 `node scripts/publish-secrets.js` 发布该 secret。配置只有本机读取，密钥不会出现在日志、网页或命令行。

运行 `node scripts/local-voice-worker.mjs --audition`，生成三个短句到 `output/voice-auditions`。当前温度 0.7、速度 1.0，输出统一到约 -20 LUFS / -2 dBTP；短句采用整句推理，口型继续由实际 PCM 音量驱动。新版参数仍需人工听辨原版相似度，不能用自动转写代替听感判断。

线上启用需要 `DEEPSEEK_TTS=local-gpu`、Worker secret `VOICE_WORKER_TOKEN` 与本机相同。运行 `node scripts/local-voice-worker.mjs` 会先预热再连接。连接期间电脑必须开机。私密 token 不能代替网页口令登录。

## 传输约束

单 GPU 顺序合成，最多三项等待/执行任务；每项最多 500 字、30 秒 PCM、30 秒等待。输出为单声道 24 kHz PCM16，沿现有字幕、动作及播放打断通道传递。取消后丢弃迟到音频，收到本机完成通知才释放执行名额；断线或超时清除待办，不自动更换声音。

参考 WAV 和台词固定在操作者本机。桥接不保存对话，只缓存固定开场白；模型包装脚本关闭会打印台词的标准输出。原始节目素材与试听仅供当前学习演示，未随网页静态资源发布。

## 验证与延迟

122 项应用测试、真实 workerd 协议测试及 Cloudflare 部署预检通过。当前参考和整句推理后的线上样本使用 6.99 秒预录音，总耗时 13.2 秒，首音约 12.9 秒；该耗时受模型/桥接状态影响，不是实际麦克风或连续性能基准。GPU 预热后单句通常约 1–3 秒合成。曾发生连接中断，桥接自动重连；随后全链路复测通过，失败记录也保留在 `cloudflare/`。

安装中补齐了官方 Python NuGet 开发头文件，保留 Blender 自带 Python。使用官方 CUDA wheel 校验后升级 PyTorch；按 [ONNX CUDA 兼容说明](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html) 配置 CUDA 12 / cuDNN 9 运行库。NLTK 发音资源从其官方数据仓库下载并核对索引中的 SHA-256，未关闭库的联网安全检查。
