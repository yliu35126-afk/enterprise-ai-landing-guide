# 扣子工作流设计

```text
Start
  -> 选择 KNOWN_PROBLEM / OPPORTUNITY_SCAN
  -> createAiLandingSession
  -> 循环：用户当轮回答 -> answerAiLandingQuestion -> 显示唯一nextQuestion
  -> canGenerateMap=true 或用户要求直接生成
  -> generateAiLandingMap
  -> 展示Markdown + 结构化关键字段
  -> 询问同意保存
  -> 单独询问同意联系
  -> saveAiLandingConsent
  -> consentToStore=true 时 convertAiLandingSession
  -> 展示人工复核状态
```

循环最多6轮。每个写节点保存 `idempotencyKey`；节点重试复用原键。任何失败不跳过授权节点。
