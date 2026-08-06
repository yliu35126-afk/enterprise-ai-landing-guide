# Authentication guide

GPT Actions 配置选择 `None`。公开 API 不需要 FDE 或 AI 供应商密钥。

创建会话后，Actions 从响应取得短期 `sessionToken`，并在当前对话后续请求的 `X-Session-Token` 头中传送。这不是全局 API 密钥，不应写入 GPT 指令、Knowledge 文件或公开文档。

如工作区禁止 Actions 域名，需要管理员将生产 API 域名加入允许列表。
