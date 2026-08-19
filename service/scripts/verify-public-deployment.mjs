import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://fde.lantuzhigou.com').replace(/\/$/, '');
const prefix = '/api/public/clawhive/v1';
const reportPath = resolve(process.env.REPORT_PATH || '../../artifacts/enterprise-ai-landing-guide/public-deployment-samples-20260807.json');

const samples = [
  {
    code: 'manufacturing',
    campaignCode: 'P1_PUBLIC_MANUFACTURING_20260807',
    message: '我们是一家仅用于公网部署验收的虚构非标精密制造企业，约200人，每周处理40份询价，每份人工报价约2小时，依赖两名老师傅。已有12个月脱敏报价单、工艺路线和材料价格记录。AI只能匹配历史相似报价并给出参考，工艺工程师确认参数和风险，销售经理审批最终报价，AI不得直接对外报价。请直接生成初版地图，未确认项标注待确认。',
    expectedTerms: ['报价', '历史', '人工', '7天'],
    convert: true,
  },
  {
    code: 'ecommerce',
    campaignCode: 'P1_PUBLIC_ECOMMERCE_20260807',
    message: '我们是一家仅用于公网部署验收的虚构汽配电商，运营30家店铺。客户经常只发图片询问型号，AI必须引导补充尺寸和接口照片；信息不足时停止推荐并转人工，不能猜型号。已有100条脱敏历史咨询，客服主管负责验收。请直接生成初版地图，未确认项标注待确认。',
    expectedTerms: ['30家', '尺寸', '接口', '转人工', '100条'],
  },
  {
    code: 'tender',
    campaignCode: 'P1_PUBLIC_TENDER_20260807',
    message: '我们是一家仅用于公网部署验收的虚构工程服务企业，招标公告和附件资料很多，强制资格条件容易遗漏。AI需要提取资格要求，与企业资质库比对，只能输出可投、待确认、不建议参与三种状态；强制条件未确认时不得标为可投。已有20份脱敏历史招标文件，投标经理验收。请直接生成初版地图，未确认项标注待确认。',
    expectedTerms: ['资格', '可投', '待确认', '不建议参与', '20份'],
  },
];

async function request(path, { method = 'GET', token, body, idempotencyKey, timeout = 30_000 } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${baseUrl}${prefix}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${data?.message || text.slice(0, 200)}`);
  return data;
}

const health = await request('/health');
if (health.status !== 'ok') throw new Error('Public health check is not ok');

const results = [];
for (const sample of samples) {
  const created = await request('/sessions', {
    method: 'POST',
    body: {
      sourcePlatform: 'CLAWHIVE',
      sourceVersion: '1.2.0',
      externalSessionId: `public-${sample.code}-${Date.now()}`,
      campaignCode: sample.campaignCode,
      mode: 'KNOWN_PROBLEM',
      entryUrl: `${baseUrl}/enterprise-ai-landing-guide`,
    },
  });
  const sessionId = created.sessionId;
  const token = created.sessionToken;
  await request(`/sessions/${sessionId}/messages`, {
    method: 'POST', token, body: { message: sample.message, mode: 'KNOWN_PROBLEM' },
    idempotencyKey: `${sample.code}-message-1`, timeout: 120_000,
  });
  const map = await request(`/sessions/${sessionId}/generate-map`, {
    method: 'POST', token, idempotencyKey: `${sample.code}-map-1`, timeout: 180_000,
  });
  const evidence = Object.fromEntries(sample.expectedTerms.map((term) => [term, map.markdown.includes(term)]));
  if (Object.values(evidence).includes(false)) throw new Error(`${sample.code} map missed required evidence: ${JSON.stringify(evidence)}`);

  let conversion = null;
  if (sample.convert) {
    await request(`/sessions/${sessionId}/consent`, {
      method: 'POST', token, idempotencyKey: `${sample.code}-consent-1`,
      body: {
        consentToStore: true,
        consentToContact: false,
        companyName: '公网部署验收虚构精密制造企业',
      },
    });
    conversion = await request(`/sessions/${sessionId}/convert`, {
      method: 'POST', token, idempotencyKey: `${sample.code}-convert-1`, timeout: 60_000,
    });
  }
  results.push({
    sample: sample.code,
    campaignCode: sample.campaignCode,
    sessionId,
    currentStage: map.currentStage,
    opportunityScore: map.opportunityScore,
    evidence,
    conversion: conversion ? {
      conversionStatus: conversion.conversionStatus,
      customerId: conversion.customerId,
      opportunityId: conversion.opportunityId,
      visitId: conversion.visitId,
      taskId: conversion.taskId,
      attributionId: conversion.attributionId,
    } : null,
  });
}

const report = {
  verifiedAt: new Date().toISOString(),
  baseUrl,
  health,
  samples: results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
