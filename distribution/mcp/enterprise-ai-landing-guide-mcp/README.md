# Enterprise AI Landing Guide MCP

这是企业AI落地导航的轻量 MCP 适配层，不是 FDE 后台 MCP。它只代理 7 个落地导航工具，不提供任意数据库查询、任意文件系统访问、FDE 管理路由或服务端密钥。

## 远程 HTTPS 模式

```bash
npm install
npm run build
NODE_ENV=production \
ENTERPRISE_AI_LANDING_API_BASE=https://ai.example.com \
MCP_ACCESS_TOKEN='<32字符以上的远程访问Token>' \
MCP_ALLOWED_HOSTS='mcp.example.com' \
MCP_ALLOWED_ORIGINS='chatgpt.com,smithery.ai' \
MCP_HOST=127.0.0.1 MCP_PORT=3030 npm start
```

对外通过反向代理暴露单一 `https://mcp.example.com/mcp` 端点；TLS 在反向代理终止。当 `Origin` 存在时必须命中允许列表。

## stdio 开发模式

```bash
ENTERPRISE_AI_LANDING_API_BASE=http://127.0.0.1:3020 npm run start:stdio
```

stdio 仅用于本地开发验证；目录上架使用远程 Streamable HTTP。

## 工具

- `start_ai_landing_session`
- `answer_ai_landing_question`
- `upload_ai_landing_attachment`（远程版明确拒绝任意本地路径，安全降级为文本问答）
- `generate_ai_landing_map`
- `get_ai_landing_map`
- `request_human_fde_review`
- `delete_ai_landing_session`

业务会话 Token 由 `start_ai_landing_session` 返回，仅应存在当前 Agent 运行上下文。远程 MCP 端点的 `MCP_ACCESS_TOKEN` 是独立于业务会话的服务访问凭证。
