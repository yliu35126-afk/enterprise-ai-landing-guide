# 部署说明

1. 部署核心服务并确认 `GET /api/public/clawhive/v1/health` 通过。
2. 在受控 Node.js 22+ 运行本 MCP 适配层。
3. 使用 Nginx/Caddy/云负载均衡将 `/mcp` 反向代理到 `127.0.0.1:3030/mcp`。
4. 启用 TLS，不公开本地开发端口。
5. 把真实目录域名写入 Smithery/Glama/ModelScope 上架材料；密钥仅通过目录安全凭证配置传递。
6. 使用 MCP Inspector 或兼容客户端验证 initialize、tools/list、会话创建、追问和地图生成。

发布前把各域名加到 `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`，不要使用 `*`。
