# 语音合成双通道配置方案

## 1. 目标

为语音合成功能提供两个可切换的后端：

- `cloudflare`：调用 Cloudflare Workers AI 的 MiniMax Speech 模型。
- `minimax_direct`：由 Worker 直接调用 MiniMax API。

默认保留 `cloudflare`，需要绕过 Cloudflare Unified Billing 或 Cloudflare 余额不足时，切换为 `minimax_direct`。

前端继续调用现有语音接口，不需要感知具体的语音服务商。

## 2. 配置设计

### 2.1 普通配置

```env
# 可选值：cloudflare | minimax_direct
TTS_PROVIDER=cloudflare

# Cloudflare MiniMax
CLOUDFLARE_TTS_MODEL=minimax/speech-2.8-turbo
CLOUDFLARE_TTS_VOICE_ID=你的Cloudflare音色ID
CLOUDFLARE_TTS_SPEED=1
CLOUDFLARE_TTS_PITCH=0
CLOUDFLARE_TTS_VOLUME=1

# MiniMax 直连
# 地址应与 MiniMax 中国平台提供的接口文档保持一致
MINIMAX_TTS_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_VOICE_ID=male-qn-qingse
MINIMAX_TTS_SPEED=1
MINIMAX_TTS_PITCH=0
MINIMAX_TTS_VOLUME=1
```

`CLOUDFLARE_TTS_VOICE_ID` 和 `MINIMAX_TTS_VOICE_ID` 应分别配置。两个平台的音色 ID 不一定兼容。

### 2.2 密钥配置

MiniMax API Key 必须作为 Worker Secret 保存，不得写入前端代码、普通配置文件或日志：

```bash
npx wrangler secret put MINIMAX_API_KEY
npx wrangler deploy
```

命令执行后，在提示符中粘贴 MiniMax API Key。不要将密钥提交到 Git。

推荐使用普通按量付费 API Key（通常以 `sk-api-` 开头）。如果使用 Token Plan 订阅 Key（通常以 `sk-cp-` 开头），必须确保 Token Plan 或已购积分有效，并且所调用的模型属于套餐覆盖范围。

## 3. 请求流程

```text
前端请求语音
      |
      v
读取 TTS_PROVIDER
      |
      +-- cloudflare ------> env.AI.run("minimax/speech-2.8-turbo")
      |
      +-- minimax_direct --> POST MiniMax /v1/t2a_v2
      |
      v
统一返回 audio/mpeg
```

## 4. Cloudflare 通道

当配置为：

```env
TTS_PROVIDER=cloudflare
```

Worker 使用已有的 `env.AI` binding 调用：

```ts
await env.AI.run("minimax/speech-2.8-turbo", {
  format: "mp3",
  text,
  voice_id: env.CLOUDFLARE_TTS_VOICE_ID,
  speed: Number(env.CLOUDFLARE_TTS_SPEED || 1),
  pitch: Number(env.CLOUDFLARE_TTS_PITCH || 0),
  volume: Number(env.CLOUDFLARE_TTS_VOLUME || 1),
});
```

该通道依赖 Cloudflare AI Gateway 的余额或 Unified Billing 配置。

## 5. MiniMax 直连通道

当配置为：

```env
TTS_PROVIDER=minimax_direct
```

Worker 直接向 MiniMax 发起请求：

```http
POST ${MINIMAX_TTS_BASE_URL}/t2a_v2
Authorization: Bearer ${MINIMAX_API_KEY}
Content-Type: application/json
```

请求体：

```json
{
  "model": "speech-2.8-turbo",
  "text": "你好，我是天天。",
  "stream": false,
  "voice_setting": {
    "voice_id": "male-qn-qingse",
    "speed": 1,
    "vol": 1,
    "pitch": 0
  },
  "audio_setting": {
    "format": "mp3",
    "sample_rate": 32000,
    "bitrate": 128000,
    "channel": 1
  },
  "output_format": "hex"
}
```

MiniMax 返回的 `data.audio` 为十六进制音频数据。Worker 需要将其转换为 `Uint8Array`，然后返回：

```http
Content-Type: audio/mpeg
Cache-Control: no-store
```

使用 `output_format: "hex"` 可以让音频数据经过 Worker 返回；如果使用 URL 模式，需要注意返回 URL 有效期限制。

## 6. 音色与“天天”风格

Cloudflare 音色 ID 和 MiniMax 音色 ID 不能直接互换。切换供应商后，应使用对应供应商的音色配置。

建议先使用温和、年轻、偏女性的 MiniMax 官方音色，并通过以下参数调整风格：

```env
MINIMAX_TTS_SPEED=0.95
MINIMAX_TTS_PITCH=1
MINIMAX_TTS_VOLUME=1
```

这些参数只能接近音色风格，不能保证复刻特定人物声音。若使用声音克隆功能，必须确保音频素材拥有合法授权。

## 7. 错误处理

建议将供应商错误转换为统一的应用错误：

| 错误 | 含义 | 处理建议 |
|---|---|---|
| `401` / `2049` | API Key 无效或接口区域不匹配 | 检查密钥类型和 `MINIMAX_TTS_BASE_URL` |
| `402` / `2056` | 余额、套餐或积分不足 | 检查 MiniMax 账户资源 |
| `429` | 请求频率超限 | 限制并发并进行短暂重试 |
| `5xx` | 服务商临时故障 | 返回友好提示，可有限重试 |
| 返回缺少 `data.audio` | 合成失败或响应格式异常 | 记录 `trace_id`，不要返回空音频 |

默认不自动回退到另一个供应商，以免一次请求产生两次费用。若将来增加回退机制，应通过单独配置显式开启。

## 8. 安全要求

1. `MINIMAX_API_KEY` 只允许存在于 Worker Secret。
2. 禁止在浏览器端暴露 MiniMax API Key。
3. 禁止在日志中打印完整 Key、`Authorization` 请求头或完整请求体。
4. 对文本长度设置上限，避免异常请求消耗大量额度。
5. 对语音接口增加请求频率限制。
6. 生产环境使用 HTTPS，并校验 MiniMax 响应状态码和 `base_resp.status_code`。

## 9. 验收标准

- `TTS_PROVIDER=cloudflare` 时，现有 Cloudflare 语音流程正常。
- `TTS_PROVIDER=minimax_direct` 时，Worker 能通过 MiniMax 返回有效 MP3。
- 切换配置后，前端调用方式不变。
- 手机端能正常加载并播放语音。
- API Key 不出现在前端、日志、错误响应或 Git 历史中。
- Cloudflare 余额不足时，能够清晰提示配置切换，不返回无声的成功响应。

## 10. 回滚方式

将配置改回：

```env
TTS_PROVIDER=cloudflare
```

然后重新部署 Worker：

```bash
npx wrangler deploy
```

## 11. 官方参考

- [MiniMax 同步语音合成 HTTP](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)
- [MiniMax Token Plan 常见问题](https://platform.minimax.cn/docs/token-plan/faq)
- [Cloudflare MiniMax Speech 2.8 Turbo](https://developers.cloudflare.com/ai/models/minimax/speech-2.8-turbo/)
