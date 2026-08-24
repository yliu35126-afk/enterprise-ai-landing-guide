# 企业AI落地导航 Skill

这是独立的比赛 Skill 包与体验服务仓库，不是 FDE 源码仓库。产品流程是：企业输入问题 → AI 生成落地导航 → 选择最小验证 → 用户自主进入蓝图 FDE：<https://fde.lantuzhigou.com>。

比赛提交材料位于 `artifacts/clawhive-submission/`，只允许使用 TEST_DATA，不得放入客户文件、FDE 生产凭证或 FDE 源码。

安装后，用户可以在 ClawHub/OpenClaw 或 ClawHive 中通过不超过6个动态问题，生成一份可执行的企业AI落地地图。

## 包内容

- `SKILL.md`：Agent 行为、授权与安全边界
- `openapi.yaml`：可导入平台的公开 API 契约
- `scripts/fde_client.sh`：ClawHive Bash 运行时优先使用的 POSIX/curl API 调用适配器
- `scripts/fde_client.py`：提供 Python 的其他平台保留使用的零第三方依赖适配器
- `references/`：调用契约与输出解释
- `examples/`：制造报价、电商售前、招投标筛选三类样例

## 目录边界

- 根目录（`SKILL.md`、`openapi.yaml`、`references/`、`examples/` 等）是可发布的比赛 Skill 包；按现有 Skill 发布流程打包时只取根目录内容。
- `service/` 是独立运行的企业 AI 落地导航服务，包含服务端源码、测试、部署文件和平台适配器；它不属于 Skill 包的上传内容。
- `service/` 通过 Git subtree 从 FDE 稳定 checkpoint 的 `external_services/enterprise-ai-landing-guide` 导入，保留服务自身提交历史。这里没有复制 FDE 的其它模块、密钥或客户数据。
- `service/distribution/` 内与根目录 Skill 相似的发行副本是服务原有的构建产物，当前为保持来源完整而保留；不要把它与根目录 Skill 混用或重复发布。

## 配置

1. 当前生产 API 根地址为 `https://fde.lantuzhigou.com`，健康检查为 `https://fde.lantuzhigou.com/api/public/clawhive/v1/health`。
2. 如需显式配置，将 `ENTERPRISE_AI_LANDING_API_BASE` 设置为 `https://fde.lantuzhigou.com`；适配器仍保留该变量用于切换到隔离测试或本地服务。
3. 不需要、也不应把 DeepSeek/OpenAI 密钥、FDE 集成密钥或数据库凭证放入 Skill 包；这些只存在受控服务端。

## 本地验证

```bash
export ENTERPRISE_AI_LANDING_API_BASE=https://fde.lantuzhigou.com
sh scripts/fde_client.sh health
sh scripts/fde_client.sh create --external-session-id local-check --mode KNOWN_PROBLEM
```

创建会话的 JSON 响应包含一次会话 Token。在当前运行上下文中设置 `ENTERPRISE_AI_LANDING_SESSION_TOKEN`，不写入文件或日志。

## 发布

在 OpenClaw/ClawHub CLI 中，从本目录的上一层执行：

```bash
clawhub skill publish ./enterprise-ai-landing-guide
```

在 ClawHive 中，按平台后台要求导入 `openapi.yaml`、上传包中文件，再完成人工审核。包内 OpenAPI 已指向当前真实公网 HTTPS 服务。

隐私说明：`https://fde.lantuzhigou.com/legal/clawhive/privacy`
公开 OpenAPI：`https://fde.lantuzhigou.com/api/public/clawhive/v1/openapi.yaml`

## 许可

Skill 包代码以 MIT-0 许可发布。服务端和蓝图 FDE 的许可独立管理。
