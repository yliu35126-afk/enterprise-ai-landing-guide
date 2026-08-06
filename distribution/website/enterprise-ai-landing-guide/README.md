# 蓝图官网入口

官网入口直接复用核心服务的 `/enterprise-ai-landing-guide`，不依赖 ClawHub，不需要登录 FDE，不公开 FDE 后台。

- `sourcePlatform` 由前端固定为 `FDE_WEBSITE`，URL 不允许覆盖。
- 只接收可选 `campaignCode`查询参数。
- 桌面端和移动端共用同一交互与授权逻辑。
- 生产分享链接必须使用 HTTPS。

## 嵌入

把 `embed.html` 中的 `https://ai.example.com` 替换为真实域名，然后放入官网页面。建议优先使用独立链接，嵌入时需要核对 CSP 和同域隐私配置。

## 生成分享链接

```bash
node share-link.mjs https://ai.example.com Q3_MANUFACTURING
```

输出链接只包含 `campaignCode`，不包含 Token、联系信息或 FDE 字段。
