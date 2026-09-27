# 天天的小花园 · 儿童实时互动原型

学习演示版已部署至 [天天的小花园](https://tiantian-garden.1255529524.workers.dev)。当前版本使用 Cloudflare 中文识别 → DeepSeek 对话/动作 → 本机 RTX 4060 Ti / GPT-SoVITS 天天角色声音；本机桥接通过受保护的出站 WebSocket 接入线上 Worker。MeloTTS 与 MiniMax 仍可显式选择，真实麦克风、浏览器播放和“天天”音色相似度仍待验收，儿童真实会话仍关闭。证据见 [RELEASE.md](docs/RELEASE.md)，本机音色见 [运行说明](local-voice/README.md)。

在屏幕中展示天天模型，用自然语音与孩子互动，由大模型选择角色动作。默认中文、4–8 岁，桌面和窄屏浏览器可运行。页面默认加载独立的轻量模型；真实平板的长时间性能仍需实机验收。

## 立即体验

在项目根目录双击 **`Start_Cloudflare.cmd`**。首次会安装依赖，并在缺失时从示例创建 `companion/.dev.vars`，已有配置不会覆盖。随后构建并启动 Cloudflare 本地模拟器；终端显示 Ready 后打开 <http://127.0.0.1:8787/>，使用 `.dev.vars` 的 `ACCESS_CODE` 登录。需要 Node.js 22.12 或更新版本。保留启动窗口，按 Ctrl+C 关闭服务。本地模拟器不需要 Cloudflare 登录，也不会发布到云端；8787 已有本项目运行时直接访问即可。

在 `companion/.dev.vars` 配置 `DEEPSEEK_API_KEY` 可启用 DeepSeek 互动；本机 GPU 模式设置 `DEEPSEEK_TTS=local-gpu` 并保持根目录 `Start_Local_Voice.cmd` 运行。修改后重启模拟器。OpenAI 实时语音及定制音色也使用此文件，线上配置则使用 Wrangler secrets，详见 [Cloudflare 部署说明](docs/CLOUDFLARE.md)。不要将密钥发到聊天。

保留的 Node 版本可通过 `Start_Companion.cmd` 启动，它读取 `.env`，支持演示与旧 WebRTC，不提供 DeepSeek。该版本的开发运行方式：

```powershell
cd companion
npm ci
npm run dev
```

打开 <http://127.0.0.1:3210>。Windows 沙箱环境下已使用 Vite 原生配置加载，避免向上扫描受限目录。开发模式关闭热更新，修改代码后刷新；修改服务器代码需要重启。

没有密钥时自动进入本地演示：点击话题或输入“你好”“飞一下”“摇尾巴”“闻一闻”“走两步”“跑一跑”“眨眼”“讲个故事”。预设回复会带动真实模型，不采集麦克风，不调用大模型。默认播放项目自带的瑶瑶角色化配音；也可以在家长设置中选择浏览器支持的本机中文音色。

## 声音与动作更新

- 默认使用“明亮活泼”角色配音，另有“温柔讲故事”。74 段固定配音均由本机瑶瑶语音合成并随项目打包，覆盖当前全部预设回复、故事、游戏与试听。安慰类回复放缓语速并降低音高。
- 家长设置可试听、停止试听、切换声音风格与本机音色。本机系统音色是否能播放取决于浏览器和系统权限；默认打包配音不需要浏览器调用 Windows 语音引擎。实时模式的音色以服务器配置为准；本机 GPU 模式使用固定参考和整句推理，Cloudflare MeloTTS 没有定制 speaker 参数，只适合作为通用中文回退。实时语音使用按住说话：按住按钮才会发送麦克风音频，松开后通过显式结束事件立即提交当前语句并停止发送；找不到麦克风时会自动保持连接并切换为文字互动，接上麦克风后刷新即可恢复语音。
- 动作默认“活泼”，另有“自然”和“夸张”。放大歪头、耳尾摆动与招手，加入开心小跳、飞行升高和说话点头；镜头稍微拉近。花园上方可以直接点“招招手／开心小跳／飞一下”。
- 家长设置可以切换“经典轻量版”和“精细表情版 v48”。轻量版继续作为默认项；v48 版带 22 个导出动画片段，并按所选模型限制对话动作口令。v48 没有飞行动画，收到“飞一下”时会说明并改为轻跳。
- 原始 GLB 不变；动作修改发生在浏览器副本。下颌根据配音文件的实际音量联动，浏览器系统朗读仍用节律近似。

这是一套角色化合成声音，**不是动画官方原声的复刻**。如果已有通过服务方要求创建的定制音色，在 Cloudflare 本地 `.dev.vars` 填写 `OPENAI_CUSTOM_VOICE_ID=voice_...`，重启后用于 Realtime 和 DeepSeek 的语音合成；它优先于内置声音配置。线上使用 Wrangler secret，旧 Node 版本使用 `.env`。本项目不会自动创建或上传声音样本。OpenAI 定制音色目前只开放给符合条件的客户，需要配音者同意录音和匹配的声音样本。[官方定制音色说明](https://developers.openai.com/api/docs/guides/custom-voices)

演示音频生成脚本位于 `scripts/voice/voice-manifest.js` 和 `scripts/voice/generate-demo-voice.ps1`。修改预设文本后，先用 Node 更新清单，再在有瑶瑶语音的 Windows 环境运行 PowerShell 生成 WAV；之后重新构建。引擎语速参数配合轻微的 PCM 播放速率调整实现两档声音，后者同时改变音高与速度；这不属于声音克隆。播放已打包音频不需要安装 Windows 音色。

## 连续故事和游戏

本地故事和游戏可先直接体验：输入“讲个故事”，选择种在花园或花盆，逐段推进到两个结局；输入“猜动物”进入兔子、大象和小猫的三轮游戏。答错会给提示，也可输入“跳过”“再说一遍”“重新开始”。故事中请求飞行等动作后，可以接着选择。输入“不想玩了”停止当前内容；输入“再见”会在道别配音结束后结束互动。选项也支持点击，场景仅保存在本页会话中。这些是有限预设内容，没有采集语音或调用大模型。

## 接入 OpenAI 实时语音

1. 使用 `Start_Cloudflare.cmd`，或按 [Cloudflare 本地运行说明](docs/CLOUDFLARE.md#本地运行)启动。
2. 在本机编辑 `companion/.dev.vars`，设置 `OPENAI_API_KEY`；不要将密钥放进浏览器或提交到 Git。
3. 重启服务。在“家长设置”选 OpenAI，点击“开启语音聊天”。
4. 由成年人阅读说明、确认，然后授权麦克风。建议先用耳机测试，减少外放回声。
5. 连接后按住“按住说话”按钮输入，松开后发送。支持语音自动断句、打断、文字补充、结束互动。页面切到后台也会关闭连接。

默认模型为 `gpt-realtime-2.1`，声音为 `coral`，均可由环境变量调整。Cloudflare 版默认由本站 WebSocket 中转音频，配置与动作执行由服务器持有，长期密钥不进入浏览器；Node 版暂时保留 WebRTC 连接。浏览器处理 24 kHz PCM、字幕、播放和插话截断。[官方 WebSocket 文档](https://developers.openai.com/api/docs/guides/voice-websockets)

Cloudflare 版本已接入 DeepSeek 服务选择、文字互动及 OpenAI 转写/朗读链路；本地测试通过，真实账号和语音效果待验收，详见 [DEEPSEEK.md](docs/DEEPSEEK.md)。

**当前尚未用真实密钥做端到端语音联调。** 接口已根据官方文档实现，服务器与事件协议通过模拟上游测试；账号权限、网络可达性、中文声音与真实延迟需在目标环境验收。

## 已实现

| 能力 | 当前行为 |
| --- | --- |
| 3D 角色 | 家长设置可切换经典轻量模型与 v48 表情模型；浏览器可拖动旋转、缩放、恢复视角 |
| 动作 | 动作指令按当前模型筛选；经典版支持飞行与小跑；v48 含跑步、跳跃、摇耳、摇尾、笑脸、抖毛、双眨眼等 22 个导出片段 |
| 嘴部 | 从现有嘴部动作提取下颌闭合 / 张开姿态，根据远端语音音量驱动；打包配音使用真实音量，系统朗读用节律近似 |
| 实时语音 | Cloudflare WebSocket 中转，Node WebRTC；按住说话、显式结束、普通话转写、流式语音字幕 |
| 打断 | 停止生成、清空待播音频、抑制被打断回复的后续字幕和动作 |
| 服务适配 | Cloudflare 提供 `demo`、`openai` 与 `deepseek`；对话供应商与 3D 层分离 |
| 互动主题 | 聊天、分支故事、自然探索、三轮猜动物；演示支持选择、提示、重复和结束，切换主题会结束旧会话 |
| 家长设置 | 模型、表达年龄、5/10/15 分钟时限、服务选择、省电显示 |
| 数据处理 | 本应用不存录音、不持久化聊天；字幕最多 40 条；结束后清空 |
| 基础保护 | 服务器确认、儿童模式开关、动作白名单、同源校验、连接限流、服务器定时挂断 |

正式儿童试用前须落实服务方未成年人要求。特别是 13 岁以下儿童个人数据，OpenAI 要求先实现 API 零数据保留；本项目中的 `.env` 开关**不会**替组织开通 ZDR。[官方未成年人使用指引](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)

`CHILD_USE_ENABLED=false` 为默认值，仅允许成年人测试。完成数据、授权和安全评估后，部署者才能将其设为 `true`。这仍是原型开关，不是生产级年龄核验或家长身份验证。

## 文件入口

```text
companion/
  src/main.js                 界面、互动状态、家长设置、时限
  src/dog-scene.js            Three.js、动作淡入淡出、下颌驱动
  src/providers/index.js     服务工厂
  src/providers/openai.js    WebRTC 连接、媒体资源管理
  src/providers/relay.js     Cloudflare WebSocket 与浏览器 PCM 语音
  shared/voice-relay.js      服务器控制事件白名单、动作执行与字幕转发
  shared/deepseek.js         DeepSeek 服务端对话适配器
  src/providers/protocol.js  Realtime 事件与工具指令验证
  src/providers/demo.js      不采集语音的预设演示
  shared/behavior.js         动作目录、主题、角色提示、校验
  shared/activities.js       本地故事和游戏的有限场景状态
  server/app.js              配置、会话创建 / 关闭、保护措施
  server/index.js            开发 / 发布静态服务
  tests/                     动作、协议、资源释放、HTTP 集成测试
  scripts/cloudflare/        Cloudflare 构建、发布和线上冒烟检查
  scripts/model/             模型优化与校验
  scripts/voice/             配音清单、本机音色和试听工具
  cloudflare/                Worker 实现与验收记录
  docs/                      部署、设计、验收和声音资料
```

默认模型为独立的 `assets/dog-balanced.glb`，约 23.5 MiB、50.6 万三角面；家长设置可切换到 `assets/dog-v48.glb`，约 19.6 MiB、150 万三角面，含 22 个导出动画片段。v48 保留模型拓扑与形态键，通过 Meshopt 与 1K 贴图压缩，且比轻量版更吃渲染资源；仍将轻量版设为默认。Blender 源文件有 23 个动作数据块，其中 `Look_Around` 使用驱动属性，当前 glTF 导出没有包含它；模型收到“环视”指令时播放 `Curious_Look`。导出阶段还把超过四个骨骼影响的顶点裁为权重最高的四根骨骼。v48 的笑脸候选有静帧动作检查，完整动作序列仍需浏览器实机检查。原始 `output/Skye_Animated.glb` 保留，Node 服务仍可通过 `MODEL_QUALITY=full` 切换到该原始精细模型。省电显示另外隐藏独立细毛并降低像素比，**不会减少已选模型的下载量或全部内存占用**。

## 验证与发布运行

```powershell
npm test
npm run build
npm start
```

`npm start` 使用 `dist`，绑定 `127.0.0.1`，便于本机体验，不会开放到局域网或公网。此处“发布运行”指本地生产构建，不表示已经部署在线服务。

140 项测试通过，覆盖服务端语音中转、DeepSeek 适配器、Cloudflare 会话生命周期、分支故事、游戏提示与跳过、场景隔离、打断时序和场景配音。已检查登录与退出、轻量模型的飞行显示、390×844 窄屏下的开始和结束控制，以及预设互动、字幕清理和服务切换。轻量模型通过 Khronos 校验（0 错误、0 警告）。Cloudflare 本地运行时另外通过真实 GLB/WAV 读取与登录失效测试；当前验收范围见 [RELEASE.md](docs/RELEASE.md)，历史设计见 [DESIGN.md](docs/DESIGN.md)。
