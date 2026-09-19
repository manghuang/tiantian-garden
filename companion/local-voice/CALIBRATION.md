# 角色音色对比（2026-09-16）

目标是改善原版音色与清晰度。此次完成 18 次实际 RTX 4060 Ti 合成与 Cloudflare Whisper 转写，并将线上参考切换为两个确认的天天片段组成的 3.70 秒 WAV。三句固定台词覆盖问候、安慰、冒险；三组参数分别为温度 0.7 / seed 42（线上值）、温度 0.5 / seed 42、温度 0.7 / seed 7，语速均为 0.95。

前一轮比较了 4.15 秒双短句参考，以及仅含“太好了，我钩住了！”的 3.2 秒参考候选；这两组结果保留作历史诊断。当前生产参考是重新切出的 3.70 秒天天单人片段组合，尾部补静音满足模型下限；它包含两个不同语气，便于模型学习说话人而不是只记住一句。提示台词完整写入两次“我来救”，与参考波形对齐。

| 参考 | 当前参数的转写字符差异 | 降低温度 | 更换 seed |
| --- | ---: | ---: | ---: |
| 当前双短句 | 2 / 56 | 1 / 56 | 2 / 56 |
| 单短句加静音 | 4 / 56 | 3 / 56 | 8 / 56 |

字符差异使用 OpenCC 转为简体后去标点计算，避免将繁体字误判为发音错误。它是识别文本与台词的差异，不能证明每个差异都由语音合成造成，也不能衡量原版音色相似度。样本很少，不能作为整体准确率。

当前参考降低温度后，“准备好了吗”的转写恢复匹配，但安慰句末尾变成“好呢”；更换 seed 后安慰句开头被识别为“别站起”。没有一个候选在三句上全部匹配，因此未只针对一句调参并替换生产配置。单短句候选整体表现更差，不采用。

18 次本机合成请求用时 1.088–2.029 秒，中位数约 1.212 秒；这是已经加载模型后的 HTTP 合成耗时，不包含 ASR、DeepSeek、音量归一化、网络传输或浏览器播放。原版相似度和真实麦克风仍待验收。

## 复现与材料

- `node scripts/calibrate-local-voice.mjs`：当前参考，三组参数、三句台词；结果在 `output/voice-auditions/calibration/report.json`。
- `node scripts/calibrate-local-voice.mjs --single-reference`：短参考对照；结果在 `output/voice-auditions/calibration-single-reference/report.json`。候选 WAV 已保留于本机参考目录。
- `node scripts/calibrate-local-voice.mjs --multi-reference`：两个确认的天天片段对照；结果在 `output/voice-auditions/calibration-multi-reference/report.json`。
- 添加 `--rescore` 只重算已保存转写，不再合成或调用 ASR。
- `node scripts/make-voice-comparison.mjs`：当前参考的同词原声 / 合成声听辨材料，位于 `output/voice-auditions/comparison/original.wav` 和 `generated.wav`。两者使用相同响度目标，减少音量造成的比较偏差。

同词对照便于判断音色差异，但复述参考台词不能代替新句子的泛化验收。上述固定演示材料保存本机，未打包到线上网页，不记录真实用户对话。
