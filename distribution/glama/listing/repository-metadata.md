# Glama 仓库元数据

核对日期：2026-08-07。规范来源：[Glama MCP Server Hosting](https://glama.ai/mcp/hosting)。

| 项目 | 值 |
| --- | --- |
| Package path | `distribution/mcp/enterprise-ai-landing-guide-mcp` |
| Package type | npm / TypeScript |
| Node version | 22 |
| Build | `npm ci && npm run build` |
| Test | `npm test` |
| Streamable HTTP start | `node dist/http.js` |
| stdio development start | `node dist/stdio.js` |
| MCP endpoint | `/mcp` |
| Health endpoint | MCP adapter尚需按Glama托管实例要求配置 `/ping` |
| Persistent storage | 无；状态位于统一核心服务 |
| Required secret | 上游核心API的服务级凭证，只能在Glama加密环境变量中配置 |

Glama 官方当前支持 GitHub、Dockerfile、npm 或 PyPI 部署，托管端点默认私有，平台网关提供 Streamable HTTP。实际用户来源必须在适配层固定为 `sourcePlatform=GLAMA`。
