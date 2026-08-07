# ModelScope MCP 兼容性报告

核对日期：2026-08-07。

## 已确认能力

- ModelScope 官方 MCP Server 项目同时示例了 stdio、Streamable HTTP 和 SSE，并给出 MCP Inspector 的 `tools/list` 测试方式。
- ModelScope Hub 官方工具已暴露 `ms-hub mcp list/info/deploy/undeploy`，说明平台存在 MCP 服务对象与部署能力。
- 本项目 MCP 适配器已支持 Streamable HTTP 和 stdio，并已用官方 TypeScript SDK 完成本地 `initialize` 与 `tools/list`。

来源：[ModelScope 官方 MCP Server](https://github.com/modelscope/modelscope-mcp-server) 和 [ModelScope Hub](https://github.com/modelscope/modelscope_hub)。

## 未确认项

本次公开文档检索未找到面向第三方开发者、可在未登录情况下完整核对的“新建 MCP 服务仓库+公开上架字段+审核流程”正式清单。`ms-hub mcp deploy` 可部署已存在的 server id，不足以证明本项目已拥有可提交对象。

因此当前只能给出“兼容性适配完成”，不能给出“平台内测试通过”或“已提交审核”。

