# 企业 AI 落地导航｜蓝图 FDE

企业 AI 落地导航帮助企业从真实业务问题出发，找出最值得先验证的一条 AI 场景，并形成介入流程、人工责任边界和 7 天验证方案。

## 解决什么问题

很多企业不是没有 AI 工具，而是不知道第一步应该放在哪个业务环节。本项目通过少量动态追问，把企业现状整理成可验证的最小方案，不承诺未经验证的收益，也不会替企业做最终决策。

输出包括：

- 当前最值得优先处理的业务问题；
- AI 可以介入的步骤与仍需人工负责的事项；
- 需要准备的真实资料；
- 7 天验证计划、继续条件和停止条件。

## 快速开始

### 调用公开 API

仓库提供零依赖 Python 客户端。Python 3.11 及以上可直接执行健康检查：

```bash
python3 scripts/fde_client.py health
```

客户端默认使用 `https://fde.lantuzhigou.com`，也可以通过 `--base-url` 指向经过授权的自建服务。完整接口见 [OpenAPI 定义](./openapi.yaml) 和 [API 文档](./references/API.md)。

### 本地运行服务

需要 Node.js 22.13.0 及以上版本：

```bash
git clone https://github.com/yliu35126-afk/enterprise-ai-landing-guide.git
cd enterprise-ai-landing-guide/service
npm ci
npm run build
npm test
```

真实密钥、企业资料和客户数据只能通过受控运行环境提供，不得写入源码、测试夹具或 Git 历史。服务配置和部署边界见 [服务说明](./service/README.md)。

## 最小示例

先确认服务可达：

```bash
curl --fail --silent --show-error \
  https://fde.lantuzhigou.com/api/public/clawhive/v1/health
```

创建匿名会话、继续问答和生成落地地图的请求结构见 [OpenAPI 定义](./openapi.yaml)；可直接参考 [制造业报价](./examples/01-manufacturing-quotation.md)、[电商售前](./examples/02-ecommerce-presales.md) 和 [招投标筛选](./examples/03-tender-screening.md) 示例。

## 文档

- [使用边界](./references/usage-boundaries.md)
- [运行规则](./references/runtime-rules.md)
- [输出结构](./references/output-schema.md)
- [隐私说明](./PRIVACY.md)
- [安全策略](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)
- [更新记录](./CHANGELOG.md)

## 原则

- 不编造企业事实；
- 不虚构节省金额或收益；
- 没有价值的场景会明确建议停止；
- 企业最终决策仍由人负责。

## 许可证与维护方

本项目采用 [MIT No Attribution（MIT-0）许可证](./LICENSE)。

维护方：杭州蓝图智构。项目问题请使用 GitHub Issues；安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告。
