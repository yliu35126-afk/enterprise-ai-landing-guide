# ModelScope 部署记录

## 可复用运行方式

- 远程：`node dist/http.js`，Streamable HTTP 端点 `/mcp`。
- 本地调试：`node dist/stdio.js`。
- 构建：`npm ci && npm run build`。
- 测试：`npm test`。

## 待平台内确认

1. 登录 ModelScope，确认新建第三方 MCP 对象的当前入口和必填字段。
2. 确认是采用仓库构建、托管镜像还是引用既有 HTTPS 端点。
3. 如需平台托管，只在密钥管理界面配置上游核心 API 凭证。
4. 将适配来源固定为 `MODELSCOPE`，不允许终端用户任意改写。
5. 完成 `initialize`、`tools/list`、匿名地图、删除和授权 FDE 回写实测。

不得把官方 ModelScope MCP Server 本身的发布流程，不加验证地推断为所有第三方服务的当前上架流程。

