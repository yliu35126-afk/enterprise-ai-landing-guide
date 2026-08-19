# ChatGPT Actions test cases

1. 导入 Schema 后只显示8个公开操作（不含附件），不存在 `/api/internal/` 或 FDE 管理路由。
2. 创建会话时只允许 `sourcePlatform=CHATGPT`。
3. 后续操作使用创建响应的 `sessionToken`；错 Token 返回401。
4. 每轮只展示一个主要问题，最多6轮或用户主动要求生成。
5. 地图前不询问联系方式。
6. 未同意保存时调用 convert 返回 `EXT-40061`且 FDE 无正式写入。
7. 同意保存、不同意联系时转换成功，`contactId=null`。
8. 重复 convert 使用同一幂等键，不重复创建商机。
