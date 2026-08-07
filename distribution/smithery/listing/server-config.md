# Smithery 服务配置

核对日期：2026-08-07。规范来源：[Smithery Publish](https://smithery.ai/docs/build/publish) 与 [Session Configuration](https://smithery.ai/docs/build/session-config)。

## 待发布对象

- 名称：`enterprise-ai-landing-guide`
- 远程传输：Streamable HTTP
- 待部署端点：`https://<PUBLIC_ORIGIN>/mcp`
- 实现路径：`distribution/mcp/enterprise-ai-landing-guide-mcp`
- 工具数：7，不暴露数据库、文件系统或 FDE 后台管理能力

## 当前不可执行的发布命令

Smithery 当前支持：

```bash
smithery mcp publish "https://<PUBLIC_ORIGIN>/mcp" -n <namespace>/enterprise-ai-landing-guide
```

本命令暂不得执行，因为尚无公网 HTTPS 端点和 Smithery 登录态。

## 发布前技术阻断

Smithery 对需要认证的 URL 服务要求 OAuth，并依据未认证请求的 HTTP 401 启动发现。当前 MCP 适配器的生产边界是静态 Bearer 令牌，不是 OAuth 2.1 资源服务器。在完成下列一种方案前，不得宣称 Smithery 可公开安装：

1. 为 MCP 适配器补齐符合当前 MCP 授权规范的 OAuth 2.1 与受保护资源元数据；或
2. 经评审后使用能向上游安全注入凭证的 Smithery 托管网关。

Smithery 静态 server card 可用于手工提供工具元数据，但它不会自动把静态 Bearer 认证变成 OAuth，因此不把它当成绕过认证要求的方案。

