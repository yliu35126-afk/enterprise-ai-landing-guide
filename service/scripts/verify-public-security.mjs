import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://fde.lantuzhigou.com').replace(/\/$/, '');
const prefix = '/api/public/clawhive/v1';
const reportPath = resolve(process.env.REPORT_PATH || '../../artifacts/enterprise-ai-landing-guide/public-deployment-security-20260807.json');

async function fetchResult(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(options.timeout || 60_000) });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, headers: Object.fromEntries(response.headers), data, text };
}

async function createSession(code) {
  const response = await fetchResult(`${prefix}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourcePlatform: 'CLAWHIVE', sourceVersion: '1.2.0',
      externalSessionId: `public-security-${code}-${Date.now()}`,
      campaignCode: `P1_PUBLIC_SECURITY_${code}_20260807`, mode: 'KNOWN_PROBLEM',
    }),
  });
  if (response.status !== 201) throw new Error(`create session failed: ${response.status}`);
  return response.data;
}

const health = await fetchResult(`${prefix}/health`);
if (health.status !== 200 || health.data?.status !== 'ok') throw new Error('health check failed');
const openapi = await fetchResult(`${prefix}/openapi.yaml`);
if (openapi.status !== 200 || !openapi.text.includes(`url: ${baseUrl}`) || openapi.text.includes('api.example.com') || openapi.text.includes('/api/internal/')) {
  throw new Error('OpenAPI exposure check failed');
}
const privacy = await fetchResult('/legal/clawhive/privacy');
if (privacy.status !== 200 || !privacy.text.includes('只有你明确同意保存')) throw new Error('privacy page check failed');

const blockedPaths = {};
for (const path of ['/api/health', '/api/internal/enterprise-ai-landing-guide/v1/stats', '/admin']) {
  const result = await fetchResult(path);
  blockedPaths[path] = result.status;
  if (result.status !== 404) throw new Error(`internal path exposed: ${path} returned ${result.status}`);
}

const tokenSession = await createSession('TOKEN');
const missingToken = await fetchResult(`${prefix}/sessions/${tokenSession.sessionId}/map`);
if (missingToken.status !== 401) throw new Error(`missing token returned ${missingToken.status}`);
const deleted = await fetchResult(`${prefix}/sessions/${tokenSession.sessionId}`, {
  method: 'DELETE', headers: { Authorization: `Bearer ${tokenSession.sessionToken}` },
});
if (deleted.status !== 200 || deleted.data?.deleted !== true) throw new Error('delete endpoint failed');
const afterDelete = await fetchResult(`${prefix}/sessions/${tokenSession.sessionId}/map`, {
  headers: { Authorization: `Bearer ${tokenSession.sessionToken}` },
});
if (afterDelete.status !== 404) throw new Error(`deleted session remained readable: ${afterDelete.status}`);

const uploadSession = await createSession('UPLOAD');
const uploadData = new FormData();
uploadData.append('file', new Blob([new Uint8Array(11 * 1024 * 1024)]), 'oversize-validation.txt');
const oversize = await fetchResult(`${prefix}/sessions/${uploadSession.sessionId}/attachments`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${uploadSession.sessionToken}`, 'Idempotency-Key': 'oversize-validation-1' },
  body: uploadData,
  timeout: 120_000,
});
if (oversize.status !== 413) throw new Error(`oversize upload returned ${oversize.status}`);
await fetchResult(`${prefix}/sessions/${uploadSession.sessionId}`, {
  method: 'DELETE', headers: { Authorization: `Bearer ${uploadSession.sessionToken}` },
});

const rateResponses = await Promise.all(Array.from({ length: 70 }, () => fetchResult(`${prefix}/health`)));
const rateLimitedCount = rateResponses.filter((item) => item.status === 429).length;
if (rateLimitedCount < 1) throw new Error('rate limit did not return 429');

const report = {
  verifiedAt: new Date().toISOString(),
  baseUrl,
  healthStatus: health.status,
  httpsHeaders: {
    strictTransportSecurity: health.headers['strict-transport-security'],
    contentTypeOptions: health.headers['x-content-type-options'],
    cacheControl: health.headers['cache-control'],
  },
  openApiStatus: openapi.status,
  privacyStatus: privacy.status,
  blockedPaths,
  missingSessionTokenStatus: missingToken.status,
  deleteStatus: deleted.status,
  afterDeleteStatus: afterDelete.status,
  oversizeUploadStatus: oversize.status,
  rateLimitedCount,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
