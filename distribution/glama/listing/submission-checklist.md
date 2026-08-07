# Glama 提交检查表

- [x] MCP 适配器构建和 5 项本地协议测试通过。
- [x] Streamable HTTP 和 stdio 启动路径已提供。
- [x] 7 个工具与安全边界文档已提供。
- [x] 上架文案、仓库元数据和隐私边界已准备。
- [ ] 将含 MCP 子目录的仓库连接到 Glama GitHub App，或选择 npm/Dockerfile 路径。
- [ ] 在 Glama 加密环境变量中注入上游凭证。
- [ ] 根据托管检查实际配置 `/ping` 健康端点。
- [ ] 完成平台 MCP handshake、`tools/list` 和工具真实调用。
- [ ] 在私有可见状态下检查调用日志不显示凭证。
- [ ] 验证授权转换后 `sourcePlatform=GLAMA` 在 FDE 中保留。
- [ ] 用户确认公开发布后再切换为公开目录。

当前状态：`适配完成`；受仓库发布、Glama 登录、托管和公开确认阻塞。

