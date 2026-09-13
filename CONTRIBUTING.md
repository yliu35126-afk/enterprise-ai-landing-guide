# Contributing

欢迎通过 Issue 和 Pull Request 改进文档、示例、客户端与服务实现。

## 提交前

1. 从当前默认分支创建范围单一的功能或修复分支。
2. 不提交真实客户数据、企业文件、账号、Cookie、Token、密钥、证书、数据库或运行日志。
3. 新增依赖时说明用途、来源和许可证；GPL、AGPL、未知许可证或来源不明代码不得直接引入。
4. 保持接口、示例和文档一致；不要把内部部署资料写入公开文档。
5. 在 `service/` 目录执行：

   ```bash
   npm ci
   npm run build
   npm test
   ```

6. Commit 应说明做了什么、为什么做以及影响范围，避免使用 `fix`、`update`、`test` 等无信息描述。

## Pull Request

Pull Request 需列明：起始 Commit、最终 Commit、改动范围、测试结果、兼容性影响和未完成事项。测试未运行时请明确写 `NOT_RUN`，不要写成通过。

提交贡献即表示你有权提供相关内容，并同意其按本仓库 [MIT-0 许可证](./LICENSE) 发布。
