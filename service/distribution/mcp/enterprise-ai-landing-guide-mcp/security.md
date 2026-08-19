# 安全边界

- 生产环境必须配置至少32字符的 `MCP_ACCESS_TOKEN`，并在 HTTPS 后使用。
- 同时验证 Host 和 Origin，阻断 DNS rebinding 与未授权浏览器来源。
- MCP 远程版不接受或读取用户本地文件路径。
- 会话 Token、MCP Token、FDE 集成密钥和 AI 供应商密钥不记录、不写入代码、不包含在错误响应中。
- 只有 `request_human_fde_review` 可能触发 FDE 转换，且其 Schema 强制 `consentToStore=true`。
- 联系授权是独立布尔值；未同意联系时不传送联系字段。
