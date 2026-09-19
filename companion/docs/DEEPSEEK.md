# DeepSeek 接入进度

当前线上版本使用本机 RTX 4060 Ti / GPT-SoVITS 角色音色：Cloudflare 中文识别 → DeepSeek 连续对话与动作 → 本机 GPU 天天音色 → 浏览器播放。MeloTTS 和 MiniMax 仍可通过 `DEEPSEEK_TTS` 显式切换；MiniMax 还支持通过 `TTS_PROVIDER` 在 Cloudflare AI 与 Worker 直连之间切换。真实麦克风、浏览器播放和“天天”音色相似度仍需人工试听验收。此前已修复 JSON 模式连续追问空白问题。本地网页模拟器使用 `Start_Cloudflare.cmd`。Node 旧版入口不提供 DeepSeek。

适配器调用官方 `https://api.deepseek.com/chat/completions`，默认使用当前 API 参考列出的 `deepseek-flash`，部署者可通过 `DEEPSEEK_MODEL` 指定账号可用模型。密钥使用服务端 `DEEPSEEK_API_KEY`。采用关闭思考的模式和 JSON 输出，服务端验证 `text/action/emotion`；限制历史、输入、输出和等待时间，只返回回答与合法动作，不暴露推理字段或供应商错误正文。模型列表可能变化，真实联调时应再核对账号可用模型。

实现分为语音识别、DeepSeek 对话/动作、语音合成三个模块。识别可选 Cloudflare Workers AI 或 OpenAI；输出可选浏览器朗读、OpenAI 或本机 GPU 角色模型。DeepSeek 只接收识别后的文字与最多 20 条上下文；确认页按配置说明接收方。本机 GPU 通过独立密钥主动连接线上站点，原始推理服务只监听本机；启动与音色说明见 [本机音色](../local-voice/README.md)。

## 配置与体验

在已存在的 `.dev.vars` 中自行填写密钥，勿覆盖已有口令或把密钥发到聊天。线上用 `npx wrangler secret put DEEPSEEK_API_KEY` 写入 Secret。

| 服务端配置 | 家长设置中的模式 | 实际能力 |
| --- | --- | --- |
| DEEPSEEK_API_KEY + DEEPSEEK_TTS=local | DeepSeek 文字 + 本机朗读 | 打字、字幕、动作；不依赖 AI binding |
| DEEPSEEK_API_KEY + DEEPSEEK_ASR=cloudflare + DEEPSEEK_TTS=cloudflare-minimax + AI binding + CLOUDFLARE_TTS_VOICE_ID | DeepSeek + Cloudflare 语音输入与输出 | 中文识别与 MiniMax 中文朗读均使用 Cloudflare Workers AI |
| 上述配置 + DEEPSEEK_TTS=cloudflare-melotts | DeepSeek + Cloudflare MeloTTS | 使用 `@cf/myshell-ai/melotts` 输出 MP3；浏览器端解码后播放，明亮 / 温柔映射为轻微播放速度与音高变化 |
| 上述配置 + DEEPSEEK_TTS=local-gpu + 在线本机 worker | DeepSeek + 本机角色音色 | 可选旧路径；固定参考生成新回答，完整预录音链路已通过，原版相似度仍待试听确认 |
| DEEPSEEK_API_KEY + DEEPSEEK_TTS=cloudflare-minimax + AI binding + CLOUDFLARE_TTS_VOICE_ID | DeepSeek + Cloudflare MiniMax 中文音色 | Cloudflare Workers AI 调用 MiniMax Speech 2.8，使用服务端配置的 `voice_id` 合成 WAV；不需要保持本机 GPU 在线 |
| DEEPSEEK_API_KEY + TTS_PROVIDER=minimax_direct + MINIMAX_API_KEY + MiniMax TTS 配置 | DeepSeek + MiniMax 直连中文音色 | Worker 直连 `/v1/t2a_v2`，接收 hex MP3 后转为受保护的音频分片；不依赖 Cloudflare Unified Billing |
| DEEPSEEK_API_KEY + OPENAI_API_KEY | DeepSeek 对话 + OpenAI 语音 | 24 kHz PCM 音频 → OpenAI 转写 → DeepSeek 回答/动作 → OpenAI PCM 朗读 |
| OPENAI_API_KEY | OpenAI 实时语音 | 默认选项，使用原有实时 WebSocket 中转 |

朗读默认 `OPENAI_TTS_MODEL=gpt-4o-mini-tts`、`OPENAI_TTS_VOICE=coral`，转写默认 `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`。已有可用定制音色时由 `OPENAI_CUSTOM_VOICE_ID` 覆盖内置音色；当前声音仍不是动画原声。例子见 `.dev.vars.example`，无需在前端填写任何密钥。

### Cloudflare MeloTTS 回退音色

设置 `DEEPSEEK_TTS=cloudflare-melotts` 后，Worker 使用 AI binding 调用 `@cf/myshell-ai/melotts`，发送 `prompt` 和 `lang=zh`，再将 MP3 分段传给浏览器解码播放。MeloTTS 的 Cloudflare 接口没有公开 speaker、音高、情绪等定制参数，因此“天天”只做角色化的语速 / 断句近似，不是声音克隆；家长设置中的明亮 / 温柔会映射到小幅播放速度变化。

如果部署者需要其他语言，可设置 `CLOUDFLARE_MELOTTS_LANG` 为模型支持的语言代码。未配置 AI binding 时，服务会在开始互动前明确提示；不会静默改用其他声音。

### Cloudflare MiniMax 默认中文音色

`DEEPSEEK_TTS` 支持 `cloudflare-melotts`、`local-gpu`、`cloudflare-minimax`、`openai` 和本机离线 `local`。当它选择 `cloudflare-minimax`（或未设置而设置了 `TTS_PROVIDER`）时，`TTS_PROVIDER` 支持 `cloudflare` 与 `minimax_direct`；前者使用现有 `AI` binding 调用 `minimax/speech-2.8-turbo`，后者由 Worker 直连 MiniMax HTTP API。浏览器只知道当前模式，不会收到模型密钥、请求头或 `voice_id`。

当前默认使用 MiniMax 官方中文系统音色 `Chinese (Mandarin)_Cute_Spirit`。如果以后要换成拥有授权的定制音色，只需在 MiniMax 音频服务中创建并取得新的 `voice_id`；Cloudflare 负责部署链路和模型调用，不负责从一段录音自动创建音色。配置线上 Worker 时：

```powershell
npx wrangler secret put CLOUDFLARE_TTS_VOICE_ID
```

然后把 `wrangler.jsonc` 中的 `DEEPSEEK_TTS` 改为 `cloudflare-minimax`，按需把 `CLOUDFLARE_TTS_MODEL` 改为 `minimax/speech-2.8-hd`，再执行构建、测试和部署。可选的 `CLOUDFLARE_TTS_SPEED`、`CLOUDFLARE_TTS_PITCH`、`CLOUDFLARE_TTS_VOLUME`、`CLOUDFLARE_TTS_EMOTION` 也只应配置在 Worker 变量/Secret 中。未配置 `voice_id`、AI binding 或受支持模型时，服务会明确拒绝开启会话，不会静默换成其他声音。

启动并登录后，打开家长设置 → 选择 DeepSeek → 保存 → 开始互动 → 阅读本次数据说明。切换服务会先结束旧会话。

### MiniMax 直连通道

需要绕过 Cloudflare Unified Billing 或 Cloudflare 余额不足时，将 Worker 变量切换为：

```text
TTS_PROVIDER=minimax_direct
MINIMAX_TTS_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_VOICE_ID=lovely_girl
MINIMAX_TTS_SPEED=1.08
MINIMAX_TTS_PITCH=2
MINIMAX_TTS_VOLUME=1
```

把密钥写入 Worker Secret，不要写入前端资源、普通提交文件或日志：

```powershell
npx wrangler secret put MINIMAX_API_KEY
npx wrangler deploy
```

Worker 调用 `POST ${MINIMAX_TTS_BASE_URL}/t2a_v2`，请求固定使用非流式 MP3、32000 Hz、128 kbps、单声道和 `output_format=hex`，再把 `data.audio` 转换为 MP3 分片发送给现有播放器。Cloudflare 与 MiniMax 的音色 ID 分开配置，不能互换。直连通道会校验 HTTP 状态和 `base_resp.status_code`，只向页面返回安全的中文提示；不会把供应商错误正文或 `Authorization` 头返回给浏览器，也不会自动向另一个供应商重试。账号区域或额度错误会提示检查密钥、接口地址或切换 `TTS_PROVIDER`。

每轮回答的 `emotion` 会在 Worker 内映射为 MiniMax 的动态语速、音高、音量与 `voice_modify` 强度/音色质感：`happy` 更快更亮，`sad` 更慢更沉，`calm` 更柔和，`curious` 更轻快上扬。情绪参数只在服务端发送，不下发浏览器。

## 生命周期与限制

- 与 OpenAI 共用同源、Cookie、CSRF 验证，一次性 WebSocket 升级和全站三条/每登录一条并发限制。历史只在服务器内存中保留，不接受浏览器传入 system/assistant 或工具结果；关闭连接会中止请求并清空上下文。
- 输入最多 500 字，每分钟最多 20 次回答。按住说话时以能量阈值识别约 200 ms 的起声；松开按钮会发送显式结束事件并立即转写，不再等待 1.1 秒静音尾巴。旧客户端仍可在约 1.1 秒停顿后自动结束；单句超过 20 秒丢弃并提示缩短。此方法不是语义 VAD，弱声、噪声和回声表现需要实测。
- 识别、生成、合成依次执行，会比原生实时链路多出等待。各上游请求最多 20 秒，整轮最多约 55 秒；客户端支持打断、静音、结束和进入后台关闭麦克风。
- 听到位置用于处理打断：无法把合成音频毫秒数准确对应到文字，因此从后续上下文中删除未完整听到的助手回答。已显示字幕可以保留供本页查看。
- 本机朗读不可用时保留文字和动作，页面明确提示；不自动切换到额外的外部声音服务。

配置 OpenAI 时已加入输入和生成回答的文字检查，先检查后显示字幕、动作及合成声音；标记内容使用预设回复，检查异常时停止本轮。检查也会将输入及回答文字发给 OpenAI，确认页已说明。仅有 DeepSeek 密钥时仍只有基础本地规则。实现、测试范围与限制见 [MODERATION.md](MODERATION.md)。

账号与预录音链路已通过；真实麦克风、浏览器播放、弱网、静音和目标音色仍需体验验收。当前浏览器自动化连接不可用，新选择页的浏览器复核尚未完成。实际审核效果、OpenAI Realtime 输入检查、家长同意和儿童数据配置仍未完成，保持 `CHILD_USE_ENABLED=false`。

依据：[DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)、[OpenAI 语音识别](https://developers.openai.com/api/docs/guides/speech-to-text)、[OpenAI 语音合成](https://developers.openai.com/api/docs/guides/text-to-speech)、[Cloudflare AI 模型目录](https://developers.cloudflare.com/ai/models/)、[Cloudflare MiniMax Speech 2.8 Turbo](https://developers.cloudflare.com/ai/models/minimax/speech-2.8-turbo/)、[MiniMax 同步语音合成 HTTP](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)。
