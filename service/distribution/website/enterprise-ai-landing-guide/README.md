# 蓝图官网入口

官网入口直接复用核心服务的 `/enterprise-ai-landing-guide`，不依赖 ClawHub，不需要登录 FDE，不公开 FDE 后台。

- `sourcePlatform` 由前端固定为 `FDE_WEBSITE`，URL 不允许覆盖。
- 只接收可选 `campaignCode`查询参数。
- 桌面端和移动端共用同一交互与授权逻辑。
- 生产分享链接必须使用 HTTPS。

## 嵌入

`embed.html` 已指向 `https://fde.lantuzhigou.com`，可直接放入官网页面。嵌入时仍需核对 CSP 和同域隐私配置。

## 生成分享链接

```bash
node share-link.mjs https://fde.lantuzhigou.com Q3_MANUFACTURING
```

输出链接只包含 `campaignCode`，不包含 Token、联系信息或 FDE 字段。
