# API 调用契约

统一前缀：`/api/public/clawhive/v1`。完整 JSON Schema 以包内 `openapi.yaml` 为准。

ClawHive 客户端版本为 `1.3.2`，固定发送 `sourcePlatform: "CLAWHIVE"` 与 `sourceVersion: "1.3.2"`。在 ClawHive Bash 运行时必须优先使用 `scripts/fde_client.sh`，不要手写 `curl`；有 Python 的其他平台可使用保留的 `scripts/fde_client.py`。

| 顺序 | 方法与路径 | 用途 |
|---|---|---|
| 1 | `GET /health` | 最小可用性检查 |
| 2 | `POST /sessions` | 创建匿名会话和短期 Token |
| 3 | `POST /sessions/{id}/messages` | 提交一轮回答，只获取一个主要问题 |
| 可选 | `POST /sessions/{id}/attachments` | 上传当前会话临时附件 |
| 4 | `POST /sessions/{id}/generate-map` | 生成结构化地图与 Markdown |
| 5 | `GET /sessions/{id}/map` | 读取已生成地图 |
| 6 | `POST /sessions/{id}/consent` | 保存两类独立授权 |
| 7 | `POST /sessions/{id}/convert` | 受控申请 FDE 人工复核 |
| 随时 | `DELETE /sessions/{id}` | 删除匿名会话与临时附件 |

## 请求头

- 会话端点：`Authorization: Bearer <sessionToken>`
- 所有写操作（创建会话和删除除外）：`Idempotency-Key: <8-128字符>`
- JSON 写操作：`Content-Type: application/json`

## 幂等约定

同一请求重试必须使用同一幂等键。新操作必须使用新键。同键替换内容会返回 `409 EXT-40970`。

## 统一错误

```json
{
  "code": "EXT-40020",
  "message": "消息不能为空",
  "requestId": "request-id",
  "timestamp": "2026-08-06T00:00:00.000Z",
  "data": null
}
```

不向用户展示服务器堆栈、文件路径、Token、密钥或数据库细节。

## 平台来源

`sourcePlatform` 使用服务端启用的统一枚举，例如 `CLAWHUB`、`CLAWHIVE`、`LOBSTER_AI`、`COZE`、`CHATGPT`、`DIFY`、`SMITHERY`、`GLAMA`、`MODELSCOPE`、`FDE_WEBSITE`。不得伪造用户ID；无稳定外部用户ID时可不传。

## ClawHive shell 客户端

```bash
sh scripts/fde_client.sh health
sh scripts/fde_client.sh create --external-session-id current-chat --mode KNOWN_PROBLEM
sh scripts/fde_client.sh message --session-id SESSION_ID --text "报价依赖两名老师傅"
sh scripts/fde_client.sh generate --session-id SESSION_ID
sh scripts/fde_client.sh map --session-id SESSION_ID
sh scripts/fde_client.sh consent --session-id SESSION_ID --store --company "企业名称"
sh scripts/fde_client.sh convert --session-id SESSION_ID
sh scripts/fde_client.sh delete --session-id SESSION_ID
```

`diagnose` 在同一进程中执行 create → message → generate，适合首轮验收：

```bash
sh scripts/fde_client.sh diagnose --external-session-id clawhive-check --mode KNOWN_PROBLEM --text "报价依赖两名老师傅" --test-data
```

请求消息的字段始终为 `message`；`--test-data` 仅增加 `dataClassification: "TEST_DATA"`，不改变普通会话默认的 `BUSINESS`。`diagnose` 输出可能含供隐藏续接上下文使用的 `sessionToken`，运行时必须遮蔽，不得向用户展示或持久化。
