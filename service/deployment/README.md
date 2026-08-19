# 生产部署说明

该目录只提供可复现的容器与 HTTPS 反向代理配置，不包含任何生产密钥、域名或租户凭证。

## 边界

- 容器只对宿主机 `127.0.0.1` 暴露端口，由 Caddy/Nginx 终止 HTTPS。
- SQLite 和临时附件仅写入命名卷 `/app/.runtime`；根文件系统只读。
- 转换密钥、联系方式加密密钥、统计密钥和模型密钥必须通过生产密钥管理注入，不得写入 `.env`、Skill 包或镜像。
- FDE 仅允许明确的企业 ID，且必须与 FDE 端的允许列表一致。

## 启动

1. 在密钥管理器或当前终端中注入 `compose.yaml` 标记为必填的变量。
2. 设置 `EXTERNAL_PUBLIC_BASE_URL=https://<域名>`。
3. 运行 `docker compose up -d --build`。
4. 将 `Caddyfile.example` 的域名替换为已授权域名，再启用代理。

## 验证

```bash
curl -fsS https://<域名>/api/public/clawhive/v1/health
curl -fsS https://<域名>/enterprise-ai-landing-guide >/dev/null
docker compose ps
docker inspect --format '{{json .State.Health}}' enterprise-ai-landing-guide
```

只有实际域名 HTTPS、公网 API、FDE 转换、限流和重启恢复都通过后，才能把“已部署”写入平台上架材料。
