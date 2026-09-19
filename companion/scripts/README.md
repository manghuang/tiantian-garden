# 工具脚本

- `cloudflare/`：Worker 资源构建、密钥发布和 Cloudflare 冒烟检查。
- `model/`：轻量模型生成与交付模型校验。
- `voice/`：固定配音清单、本机 GPU 音色桥接、试听和校准工具。

应用测试仍在 `tests/`，运行时源码分别在 `src/`、`server/`、`shared/` 和 `cloudflare/`。脚本通常从 `companion` 目录执行；可用入口见根目录 `package.json` 和 `README.md`。
