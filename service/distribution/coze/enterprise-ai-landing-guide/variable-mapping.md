# 变量映射

| 扣子变量 | API字段 | 处理 |
|---|---|---|
| `conversation_id` | `externalSessionId` | 稳定不敏感对话ID |
| 固定值 | `sourcePlatform` | `COZE` |
| 固定值 | `sourceVersion` | `1.2.0` |
| `session_id` | 路径 `{id}` | 创建会话响应 |
| `session_token` | `X-Session-Token` | 短期变量，不写日志 |
| `current_answer` | `message` | 当轮用户原话 |
| `write_key` | `Idempotency-Key` | 同请求重试复用 |
| `map_json` | `map` | 结构化地图 |
| `map_markdown` | `markdown` | 用户可读结果 |
| `allow_store` | `consentToStore` | 显式布尔授权 |
| `allow_contact` | `consentToContact` | 单独布尔授权 |

`sourcePlatform`、`sourceVersion` 由工作流常量节点注入，不从用户文本提取。
