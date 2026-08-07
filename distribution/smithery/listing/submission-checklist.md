# Smithery 提交检查表

- [x] 7 个工具的输入/输出 Schema 本地测试通过。
- [x] Streamable HTTP `initialize` 和 `tools/list` 本地真实调用通过。
- [x] 包内无 FDE 密钥、Cookie 或用户会话 Token。
- [x] 上架文案、隐私与认证边界已准备。
- [ ] 部署公网 HTTPS `/mcp` 端点。
- [ ] 补齐 OAuth 2.1 或经安全评审的平台托管认证。
- [ ] 未认证请求返回符合发现规范的 HTTP 401。
- [ ] 使用 Smithery 登录态提交 URL 并完成 server scan。
- [ ] 在 Smithery 真实调用中创建会话、生成地图和删除匿名数据。
- [ ] 在授权样本中验证 `sourcePlatform=SMITHERY` 进入 FDE。
- [ ] 复核上架页和截图不含账号、令牌或 Cookie。

当前状态：`适配完成`；公开发布受 HTTPS、OAuth 和平台登录阻塞。

