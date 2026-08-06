# 网易有道龙虾安装与验证

龙虾优先复用 OpenClaw 标准 Skill 包，不复制诊断后端。可安装包位于：

`../../openclaw/enterprise-ai-landing-guide/`

安装后将 `ENTERPRISE_AI_LANDING_API_BASE` 设为真实 HTTPS 服务根地址，调用创建会话时必须使用：

```text
sourcePlatform = LOBSTER_AI
sourceVersion = 1.0.0
```

不需要、也不得将 FDE 内部密钥、AI 供应商密钥或数据库凭证配置到龙虾。

## 验证顺序

1. 检查龙虾当前版本的 OpenClaw Skill 安装入口。
2. 优先尝试 ClawHub 安装；如不可用，安装本地 Skill 目录或公开 GitHub 仓库。
3. 运行 `scripts/fde_client.py health`，再完成创建会话、多轮追问、地图、授权与FDE转换。
4. 在FDE来源明细确认 `sourcePlatform=LOBSTER_AI`。

当前尚未完成龙虾平台内安装，不宣称已上架。实际结果记录在 `compatibility-report.md`。
