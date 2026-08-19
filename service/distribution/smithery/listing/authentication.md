# Smithery 认证边界

- 核心 API 的 `sessionToken` 是短期、按匿名会话绑定的不透明令牌，它不是平台账号凭证。
- MCP 远程端点的当前生产保护为服务级 Bearer 令牌，不得写入目录、安装示例、视频或 Git。
- Smithery 官方 URL 发布规范明确要求：远程服务使用 Streamable HTTP；如果需要认证，支持 OAuth。
- 本适配器尚未实现 OAuth 2.1 资源服务器，所以当前状态是“受登录、公网部署和认证规范阻塞”，不是“已公开上架”。

规范：[Smithery Publish](https://smithery.ai/docs/build/publish)。

