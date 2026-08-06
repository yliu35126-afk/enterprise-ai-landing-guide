# 企业AI落地导航 Dify Tool Plugin

插件提供 7 个工具，所有请求都调用同一核心 API，`sourcePlatform` 固定为 `DIFY`。插件不包含诊断状态机、AI 主提示词、独立数据库或 FDE 内部凭证。

## 本地包

```bash
dify plugin package ./enterprise-ai-landing-guide-plugin
```

在 Dify 的插件页选择“通过本地文件安装”并上传 `.difypkg`。自托管 Dify 默认可能要求签名；生产环境应按 Dify 的第三方签名流程处理。

安装后只配置 `api_base`（真实 HTTPS 根地址）。不配置 DeepSeek/OpenAI 密钥、FDE 密钥或数据库凭证。

`upload_ai_landing_attachment` 接收 Dify 流程中已提取的文本与显示文件名，不读取本地路径、不从任意 URL 下载文件。
