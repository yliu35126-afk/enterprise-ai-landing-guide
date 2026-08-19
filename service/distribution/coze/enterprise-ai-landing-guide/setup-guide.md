# 扣子配置指南

1. 在扣子创建 API 插件，导入 `api-plugin-openapi.yaml`。
2. 将 `servers[0].url` 替换为真实 HTTPS 核心服务域名。
3. 按 `variable-mapping.md` 创建变量，把 `sessionToken` 映射到 `X-Session-Token`。
4. 按 `workflow-design.md` 建立循环和授权分支，禁止用联系方式作为地图前置条件。
5. 导入 `agent-instructions.md`，用 `test-cases.md` 逐项验证。
6. 组织内测试通过后再提交公开审核。

当前包不包含凭证。需要平台登录、实名或审核时，由账号所有者在扣子界面完成。
