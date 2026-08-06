# 企业AI落地导航 Skill

安装后，用户可以在 ClawHub/OpenClaw 或 ClawHive 中通过不超过6个动态问题，生成一份可执行的企业AI落地地图。

## 包内容

- `SKILL.md`：Agent 行为、授权与安全边界
- `openapi.yaml`：可导入平台的公开 API 契约
- `scripts/fde_client.py`：零第三方依赖的 API 调用适配器
- `references/`：调用契约与输出解释
- `examples/`：制造报价、电商售前、招投标筛选三类样例

## 配置

1. 由服务运维方部署核心 API，生产环境启用 HTTPS。
2. 将 `ENTERPRISE_AI_LANDING_API_BASE` 配置为核心服务根地址，例如 `https://ai.example.com`。
3. 不需要、也不应把 DeepSeek/OpenAI 密钥、FDE 集成密钥或数据库凭证放入 Skill 包；这些只存在受控服务端。

## 本地验证

```bash
export ENTERPRISE_AI_LANDING_API_BASE=http://127.0.0.1:3020
python3 scripts/fde_client.py health
python3 scripts/fde_client.py create --platform CLAWHUB --external-session-id local-check --mode KNOWN_PROBLEM
```

创建会话的 JSON 响应包含一次会话 Token。在当前运行上下文中设置 `ENTERPRISE_AI_LANDING_SESSION_TOKEN`，不写入文件或日志。

## 发布

在 OpenClaw/ClawHub CLI 中，从本目录的上一层执行：

```bash
clawhub skill publish ./enterprise-ai-landing-guide
```

在 ClawHive 中，按平台后台要求导入 `openapi.yaml`、上传包中文件，再完成人工审核。实际发布前必须把 OpenAPI `servers[0].url` 替换为真实 HTTPS 域名。

## 许可

Skill 包代码以 MIT-0 许可发布。服务端和蓝图 FDE 的许可独立管理。
