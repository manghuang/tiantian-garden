# Cloudflare 部署与验收

目标平台为 Cloudflare Workers + Static Assets + SQLite Durable Objects。页面、轻量模型及配音在同一站点；`GardenControl` 保存登录、限流和会话截止时间。当前线上语音链路使用 Cloudflare 中文识别与本机 GPU 角色模型；MeloTTS 和 MiniMax 仍可显式选择，原版音色相似度仍待试听确认。

## 当前线上部署

2026-09-18 更新：版本 `b903e9b3-e0ff-4ea6-b203-8468cb1c44a2` 已切换到 `DEEPSEEK_TTS=local-gpu`。本机 RTX 4060 Ti / GPT-SoVITS v2ProPlus 桥接已启动并连接，线上生产回归通过真实 GPU 开场白、Cloudflare 中文识别 → DeepSeek → 本机 TTS、打断、下一轮恢复和退出；134 项测试通过。

- 地址：https://tiantian-garden.1255529524.workers.dev；自定义域名：https://tiantian-garden.catcoder.dpdns.org
- 当前配置：默认 `DEEPSEEK_ASR=cloudflare`、`DEEPSEEK_TTS=local-gpu`。Worker 不接收本机权重或参考音频，只通过独立 `VOICE_WORKER_TOKEN` 接收本机桥接主动建立的音频连接；线上保留 `DEEPSEEK_API_KEY` Secret。使用期间需要保持根目录 `Start_Local_Voice.cmd` 运行。
- 上一版：`83ba14b0-70cb-46d2-8dd5-c47ec13fd4d8`，曾尝试 MiniMax Speech 2.8 Turbo；余额不足时回退系统朗读，已切回本机 GPU。
- 前一语音输入版本：`a276761d-d205-47ea-b169-e8b098c8a9f7`，只使用浏览器本机声音输出，历史 [音频输入验收](cloudflare/audio-acceptance-2026-09-14.json) 保留。
- 前一文字版本：`91eb2f54-15c8-4876-a550-859af6bc1759`；更早 `e9a4e1e9-74a8-480f-b7df-d55af8fe395c` 缺少连续对话修复。
- 独立线上口令保存在本机 `.env.production`，此文件已被 Git 忽略；本地 `.dev.vars` 的示例口令未发布。DeepSeek 密钥由 Wrangler secrets 存储，没有进入网页资源。
- `node scripts/publish-secrets.js` 将 `.env.production` 的口令和 `.dev.vars` 中已填写的模型密钥通过标准输入写入 Worker secrets；不打印值，不删除未填写的已有云端 secret。运行前检查 `wrangler.jsonc` 的目标账号和地址。
- 历史文字版本：102 项自动测试及当时 dry-run 通过，Worker 71.73 KiB / gzip 18.42 KiB。真实线上 24 项断言通过：HTTPS/CSP、登录前保护、Secure/HttpOnly Cookie、CSRF/跨站拒绝、完整 GLB/WAV、WebSocket、两轮 DeepSeek 回答与动作、上下文保留、退出断线及旧 Cookie 撤销。记录见 [云端验收数据](cloudflare/acceptance-2026-09-14.json)。
- 尚未验证：线上浏览器画面、本机朗读、真实麦克风/原声音色、实际五分钟到期及 Alarm、回滚演练、移动设备长期性能。浏览器控制连接失败；服务端鉴权与文件检查不代表画面验收。`CHILD_USE_ENABLED=false`。

## 当前验证证据

- `npm run cf:build`：83 个应用资源，共约 52.0 MiB，最大文件为 23.5 MiB 模型，均小于 Cloudflare 单文件 25 MiB 限制。Wrangler 自身还会生成资源清单。
- `npm run cf:check`：MiniMax 默认版本预检通过并已部署。2026-09-13 的 71.39 KiB 预检属于此前历史版本。
- `npm test`：134 项通过，覆盖手机录音兼容、文字模式、语音播放打断、MeloTTS / MiniMax 音频、云端失败兜底和 DeepSeek 适配器回归测试。后端生命周期测试使用存储/上游替身。
- `node scripts/mobile-live-smoke.mjs`：线上开场白、文字回复、合成 WAV → Cloudflare 识别 → DeepSeek 回复及退出清理通过；当前 MiniMax 返回 402/2021 时明确报告本机朗读兜底。该脚本不模拟真实手机浏览器播放。
- `npm run cf:relay-smoke`：真实本地 workerd / WebSocketPair / Durable Object 连接通过 OpenAI 中转、DeepSeek 文字及转写/合成音频、字幕、服务端动作、注入拒绝、名额回收和退出测试。`npm run cf:relay-smoke -- --browser` 另提供回环地址测试页，用本地测试音验证实际 AudioWorklet 与播放；不连接模型服务、不采集麦克风。
- `npm run cf:smoke`：在真实本地 workerd / Durable Objects 运行时验证登录、CSRF、24,603,508 字节 GLB、WAV 读取、退出和旧 Cookie 失效。此检查不创建 OpenAI 会话。
- 历史浏览器检查通过本地版本的登录、模型渲染、故事选项、配音请求成功和退出回到登录页。现已完成用户账号授权及线上部署；当前浏览器控制工具不可用，最新页面仍需浏览器复核。

## 本地运行

Windows 可双击项目根目录的 `Start_Cloudflare.cmd` 完成依赖检查、配置文件初始化、构建与本地启动。它不会覆盖已有 `.dev.vars`，不会登录账号或部署云端。`Start_Companion.cmd` 是旧 Node 入口，不提供 DeepSeek。

在 `companion` 目录执行：

```powershell
npm ci --include=dev
npm run cf:build
Copy-Item .dev.vars.example .dev.vars
npm run cf:dev
```

已有 `.dev.vars` 时不要覆盖。此文件只供本地 Wrangler 使用，已加入 Git 忽略。示例口令仅供回环地址演示，不能作为线上口令。浏览器访问 `http://127.0.0.1:8787/`，输入该文件中的访问口令。另一个终端执行 `npm run cf:smoke`；它仅连接该本地端口，测试登录并退出。

Windows 受限沙箱下，Wrangler/esbuild 可能需要读取父目录和写入工具日志；已在获准的本机执行环境通过预检。服务器仅监听 127.0.0.1，不能把本地模拟器直接开放公网。

## 可选：Cloudflare MeloTTS 中文语音

默认配置为：

```jsonc
"DEEPSEEK_TTS": "cloudflare-melotts",
"CLOUDFLARE_MELOTTS_LANG": "zh"
```

Worker 通过已有的 `AI` binding 调用 `@cf/myshell-ai/melotts`。模型返回 MP3，Worker 分段转发，浏览器在完整回答到达后解码并按 24 kHz 音频链路播放。MeloTTS 接口没有公开的定制 speaker、音高或情绪参数；项目只把明亮 / 温柔映射为轻微播放速度变化，用于角色化近似，不代表声音克隆。

MeloTTS 需要 `DEEPSEEK_API_KEY` 和 AI binding，不需要 `CLOUDFLARE_TTS_VOICE_ID`。本地 `.dev.vars.example` 已包含默认配置；已有 `.dev.vars` 请手动补上：

```text
DEEPSEEK_TTS=cloudflare-melotts
CLOUDFLARE_MELOTTS_LANG=zh
```

## Cloudflare MiniMax 默认中文音色

当前默认使用 MiniMax 官方中文系统音色 `Chinese (Mandarin)_Cute_Spirit`。如果以后要换成拥有授权的定制音色，可在 MiniMax 音频服务中创建并取得新的 `voice_id`，再在 Worker 配置中选择：

```jsonc
"DEEPSEEK_TTS": "cloudflare-minimax",
"CLOUDFLARE_TTS_MODEL": "minimax/speech-2.8-turbo"
```

并把音色 ID 写入 Worker Secret：

```powershell
npx wrangler secret put CLOUDFLARE_TTS_VOICE_ID
```

Worker 会通过已有的 `AI` binding 调用 Cloudflare AI 目录中的 MiniMax Speech 2.8 HD/Turbo，服务端抓取返回的 WAV 并转换成网页播放器需要的 24 kHz PCM。音色 ID、模型选择和可选的速度/音高/音量/情绪参数都不下发浏览器；未配置音色 ID 时会在创建会话前返回明确错误。Cloudflare 负责部署与调用，定制音色本身仍由 MiniMax 音频服务创建。

## 部署到账号

1. 在自己的终端完成 `npx wrangler login`，用 `npx wrangler whoami` 确认目标账号；多账号时在配置中填写正确 `account_id`。不要将 OAuth token、API key 或访问口令发到聊天或提交进 Git。
2. 默认 Worker 名为 `tiantian-garden`。当前配置已指向上述已部署账号和两个地址。迁移账号时先确认 workers.dev 子域，更新 `account_id`、`PUBLIC_ORIGIN` 与 `PUBLIC_ORIGINS`；空 origin 会拒绝所有访问。不要将本项目的账号配置直接当成自己的账号部署。
3. 执行 `npm run cf:build`、`npm test`、`npm run cf:check`。确认下方剩余验收与预期范围后，执行 `npm run cf:deploy`。首次会创建 Durable Object 的 SQLite 类；缺少 ACCESS_CODE 时只返回配置未完成，不会开放资源。
4. 使用 `npx wrangler secret put ACCESS_CODE` 写入 24–256 字符随机口令；使用 `npx wrangler secret put OPENAI_API_KEY` 设置实时/转写/合成密钥。需要 DeepSeek 时再执行 `npx wrangler secret put DEEPSEEK_API_KEY`；仅有此密钥时提供文字与本机朗读模式，配置说明见 [DEEPSEEK.md](DEEPSEEK.md)。没有模型密钥时仍可本地内容演示。口令可在自己的终端用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成。
5. 如果已有可用的目标定制音色，使用 `npx wrangler secret put OPENAI_CUSTOM_VOICE_ID` 写入。现有瑶瑶配音不等于动画原声；定制声音仍需真实账号和试听验收。保持 `CHILD_USE_ENABLED=false`，先由成年人联调。

线上不设置 `LOCAL_DEVELOPMENT`。其 HTTP 例外仅适用于 localhost/127.0.0.1 的本地模拟器地址。迁移或增加自定义域名时，在 Cloudflare 添加 Worker 自定义域名，并把所有允许的 HTTPS origin 写入逗号分隔的 `PUBLIC_ORIGINS`；保留 `PUBLIC_ORIGIN` 作为兼容的主 origin。其他域名会收到 403。不要并行运行不同 PUBLIC_ORIGINS/访问口令的灰度版本来共享同一控制对象。

## 云端验收与回滚

- 登录前不能读取模型、配音或配置；正常登录后可加载故事，退出后旧 Cookie 和资源访问应立即失效。检查 HTTPS、Cookie Secure、CSRF 和跨域拒绝。
- 两个独立浏览器测试会话归属；一个登录最多一条语音连接，全站最多三条，正在创建的连接也占名额。
- 用有效账号实测中文双向语音、打断、静音、后台退出、弱网重连、自定义音色及 5 分钟到时挂断。模拟器没有证明 OpenAI 账号权限、区域网络和音色效果。
- 用真实 Cloudflare Alarm 验证到时挂断、上游故障重试，以及 Worker 重新部署后的恢复行为。Alarm 不依赖浏览器保持在线，但仍需实测平台执行延迟。
- 记录部署 ID 和上一版本；需要回滚时使用 `npx wrangler rollback <已记录的版本ID>`。不要删除 Durable Object namespace、存储或修改 `garden-control-v1` 对象名；删除会丢失待关闭会话。当前存储格式为 version 1，回滚目标必须兼容它。
- 更换 ACCESS_CODE 后部署的新版本会撤销旧登录并将已有会话标记为待关闭；它们通过挂断请求和 Alarm 重试回收。服务方密钥更换应在已有会话清理后进行，避免旧调用无法关闭。

## 尚未解决的上线项

这是受控学习演示的 Cloudflare 适配层，仍需真实云端验收。共享口令不能证明家长身份；有效同意、儿童服务方数据设置、完整内容审核及风险处置尚未完成。Cloudflare 默认经本站服务器转发语音，服务端独占配置与动作执行；浏览器仍能输入自然语言，因此控制事件隔离不等于防住所有提示注入。DeepSeek + OpenAI 已增加文字输入与输出检查；默认 OpenAI WebSocket 将回答暂存至完整文字稿检查通过后再播放，输入检查和实际首音延迟尚待落实，详见 [MODERATION.md](MODERATION.md)。保持儿童真实语音关闭。

默认无需配置传输选项。`REALTIME_TRANSPORT=webrtc` 仅保留给维护对照，会恢复旧的浏览器直连，失去中转层的控制事件隔离；当前部署配置不启用它。Node 版仍使用旧 WebRTC。默认 WebSocket 的升级需当前登录、同源 Origin 和 CSRF 子协议；口令、API Key、CSRF 不放入 URL。预留连接 35 秒未使用便回收，连接和配置确认限时 25 秒，回答限时 45 秒，超过 20 秒未收到心跳/输入即关闭。会话硬截止由服务器计时和 Alarm 保证。实时中转对象保持活跃，不使用休眠 API；对象重启会断开语音，内存中的音频/工具状态不会恢复，遗留名额最迟在会话截止时释放。实际 Cloudflare 关闭行为、重启和 Alarm 延迟仍需云端演练。

未获取 call id 的异常创建仍存在无法可靠回收的窗口；当前 pending 记录最多保留 35 秒，已知 call id 会持续保留至确认关闭。仍需供应商预算限制和故障演练。一个共享控制对象适用于当前三条并发的试用范围，未进行高并发压测；每次受保护资源读取都会执行鉴权并产生 Worker / Durable Object 操作。没有开启应用语音、字幕或请求日志存储，平台账单和账号级日志设置仍由部署者检查。

官方依据：[静态文件限制](https://developers.cloudflare.com/workers/platform/limits/)、[先执行 Worker 再访问资源](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)。
