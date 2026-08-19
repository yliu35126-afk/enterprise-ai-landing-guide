# Enterprise AI Landing Guide Service

这是独立运行的企业 AI 落地导航服务。服务边界仅覆盖本目录内的 HTTP 服务、匿名会话、落地地图生成、平台适配器、部署脚本和测试；它不引入比赛仓库之外的 FDE 模块。

## 与根目录 Skill 的边界

- 根目录 `SKILL.md`、`openapi.yaml`、`references/` 和 `examples/` 是可发布的 Skill 包。
- `service/` 是服务端工程，不能作为 Skill 包根目录上传；从仓库根目录发布 Skill 时不要递归打包此目录。
- `service/distribution/` 中的 OpenClaw/Dify 等发行副本来自服务原有构建流程，当前刻意保留，可能与根目录 Skill 有重复文件；后续清理或重建必须单独评估。

## 来源与隔离

本目录由 FDE 稳定 checkpoint `0df4303` 中的
`external_services/enterprise-ai-landing-guide` 通过 Git subtree 导入，并保留该服务的历史提交。剥离只复制此服务目录，不复制 FDE 其它模块、密钥、环境文件或客户数据；生产凭证必须通过受控运行时环境注入。

比赛提交材料（例如仓库外的 `artifacts/clawhive-submission/`）不属于服务源码，也不会随本目录导入；需要进行依赖这些材料的完整发布验收时，应由验收环境单独提供。

## 本地验证

```bash
npm install
npm run build
npm test
```

需要服务配置时使用未提交的环境变量；不要把真实密钥写入源码、测试夹具或提交历史。
