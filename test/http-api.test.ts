import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import YAML from 'yaml';
import { config } from '../src/config.js';
import { buildApp } from '../src/server.js';

const prefix = '/api/public/clawhive/v1';
const openApiPath = resolve(import.meta.dirname, '../integrations/clawhive/openapi.yaml');

describe('Enterprise AI Landing Guide HTTP API', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp({ databasePath: ':memory:' });
  });

  afterEach(async () => {
    await app.close();
  });

  async function session(extra: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: `${prefix}/sessions`,
      payload: { sourcePlatform: 'CLAWHUB', sourceVersion: '1.0.0', mode: 'KNOWN_PROBLEM', ...extra },
    });
    assert.equal(response.statusCode, 201);
    return response.json() as { sessionId: string; sessionToken: string };
  }

  it('health只暴露最小可用性信息', async () => {
    const response = await app.inject({ method: 'GET', url: `${prefix}/health` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
    assert.equal(response.body.includes('database'), false);
  });

  it('公开OpenAPI地址使用当前服务地址且不暴露示例域名', async () => {
    const response = await app.inject({ method: 'GET', url: `${prefix}/openapi.yaml` });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /application\/yaml/);
    assert.match(response.body, new RegExp(config.publicBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(response.body.includes('https://api.example.com'), false);
    assert.equal(response.body.includes('/api/internal/'), false);
  });

  it('创建会话返回不透明Token与两种入口', async () => {
    const response = await app.inject({
      method: 'POST', url: `${prefix}/sessions`,
      payload: { sourcePlatform: 'CLAWHIVE', sourceVersion: '1.0.0' },
    });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.match(body.sessionToken, /^elag_/);
    assert.equal(body.entryModes.length, 2);
    assert.equal(body.source.sourcePlatform, 'CLAWHIVE');
  });

  it('拒绝不支持的来源平台', async () => {
    const response = await app.inject({
      method: 'POST', url: `${prefix}/sessions`,
      payload: { sourcePlatform: 'UNKNOWN_VENDOR', sourceVersion: '1.0.0' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'EXT-40010');
  });

  it('拒绝非语义化来源版本', async () => {
    const response = await app.inject({
      method: 'POST', url: `${prefix}/sessions`,
      payload: { sourcePlatform: 'CLAWHUB', sourceVersion: 'latest' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'EXT-40011');
  });

  it('会话路由必须携带有效Token', async () => {
    const created = await session();
    const response = await app.inject({
      method: 'GET', url: `${prefix}/sessions/${created.sessionId}/map`,
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'EXT-40100');
  });

  it('支持Bearer会话Token', async () => {
    const created = await session();
    const response = await app.inject({
      method: 'GET', url: `${prefix}/sessions/${created.sessionId}/map`,
      headers: { authorization: `Bearer ${created.sessionToken}` },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'EXT-40440');
  });

  it('支持X-Session-Token且一轮只返回一个主要问题', async () => {
    const created = await session();
    const response = await app.inject({
      method: 'POST', url: `${prefix}/sessions/${created.sessionId}/messages`,
      headers: { 'x-session-token': created.sessionToken, 'idempotency-key': 'http-message-1' },
      payload: { message: '我们的报价需要两名老师傅，每次约2小时。' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.extractedFacts.includes('我们的报价需要两名老师傅，每次约2小时。'));
    assert.ok((body.nextQuestion?.match(/[？?]/g) || []).length <= 1);
  });

  it('相同幂等键返回相同响应', async () => {
    const created = await session();
    const request = {
      method: 'POST' as const, url: `${prefix}/sessions/${created.sessionId}/messages`,
      headers: { 'x-session-token': created.sessionToken, 'idempotency-key': 'same-message' },
      payload: { message: '报价慢。' },
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(second.json(), first.json());
  });

  it('相同幂等键不能替换请求内容', async () => {
    const created = await session();
    const headers = { 'x-session-token': created.sessionToken, 'idempotency-key': 'conflicting-message' };
    await app.inject({ method: 'POST', url: `${prefix}/sessions/${created.sessionId}/messages`, headers, payload: { message: '报价慢。' } });
    const response = await app.inject({ method: 'POST', url: `${prefix}/sessions/${created.sessionId}/messages`, headers, payload: { message: '客服慢。' } });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'EXT-40970');
  });

  it('没有回答时不能生成地图', async () => {
    const created = await session();
    const response = await app.inject({
      method: 'POST', url: `${prefix}/sessions/${created.sessionId}/generate-map`,
      headers: { 'x-session-token': created.sessionToken, 'idempotency-key': 'map-before-answer' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'EXT-40040');
  });

  it('地图生成前不接受保存授权', async () => {
    const created = await session();
    const response = await app.inject({
      method: 'POST', url: `${prefix}/sessions/${created.sessionId}/consent`,
      headers: { 'x-session-token': created.sessionToken, 'idempotency-key': 'consent-too-early' },
      payload: { consentToStore: true, companyName: '测试企业' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'EXT-40050');
  });

  it('删除会话后彻底移除并返回404', async () => {
    const created = await session();
    const deleted = await app.inject({
      method: 'DELETE', url: `${prefix}/sessions/${created.sessionId}`,
      headers: { 'x-session-token': created.sessionToken },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);
    const afterDelete = await app.inject({
      method: 'GET', url: `${prefix}/sessions/${created.sessionId}/map`,
      headers: { 'x-session-token': created.sessionToken },
    });
    assert.equal(afterDelete.statusCode, 404);
  });

  it('错误响应不泄露堆栈、Token或内部路径', async () => {
    const created = await session();
    const response = await app.inject({
      method: 'GET', url: `${prefix}/sessions/${created.sessionId}/map`,
      headers: { 'x-session-token': 'elag_sensitive_test_token' },
    });
    const body = response.body;
    assert.equal(body.includes('stack'), false);
    assert.equal(body.includes('elag_sensitive_test_token'), false);
    assert.equal(body.includes('/Users/'), false);
  });

  it('公开响应包含安全头且禁止缓存', async () => {
    const response = await app.inject({ method: 'GET', url: `${prefix}/health` });
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(String(response.headers['permissions-policy']), /camera=\(\)/);
  });

  it('隐私与条款页可访问并明示人工确认边界', async () => {
    const privacy = await app.inject({ method: 'GET', url: '/legal/clawhive/privacy' });
    const terms = await app.inject({ method: 'GET', url: '/legal/clawhive/terms' });
    assert.equal(privacy.statusCode, 200);
    assert.match(privacy.body, /只有你明确同意保存/);
    assert.equal(terms.statusCode, 200);
    assert.match(terms.body, /人工确认/);
  });

  it('内部统计端点拒绝缺失或错误凭证', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/internal/enterprise-ai-landing-guide/v1/stats' });
    const wrong = await app.inject({
      method: 'GET', url: '/api/internal/enterprise-ai-landing-guide/v1/stats', headers: { 'x-stats-key': 'not-a-valid-key' },
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().code, 'EXT-40180');
  });

  it('OpenAPI与已注册公开业务路由逐项一致', () => {
    const document = YAML.parse(readFileSync(openApiPath, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of Object.keys(item)) documented.add(`${method.toUpperCase()} ${path}`);
    }
    const expected = new Set([
      `GET ${prefix}/health`, `POST ${prefix}/sessions`, `POST ${prefix}/sessions/{id}/messages`,
      `POST ${prefix}/sessions/{id}/attachments`, `POST ${prefix}/sessions/{id}/generate-map`,
      `GET ${prefix}/sessions/{id}/map`, `POST ${prefix}/sessions/{id}/consent`,
      `POST ${prefix}/sessions/{id}/convert`, `DELETE ${prefix}/sessions/{id}`,
    ]);
    assert.deepEqual(documented, expected);
    for (const operation of expected) {
      const [method, path] = operation.split(' ');
      assert.equal(app.hasRoute({ method: method as any, url: path.replace('{id}', ':id') }), true, operation);
    }
  });

  it('OpenAPI不暴露内部统计接口且会话操作声明Token鉴权', () => {
    const raw = readFileSync(openApiPath, 'utf8');
    const document = YAML.parse(raw) as any;
    assert.equal(raw.includes('/api/internal/'), false);
    assert.deepEqual(document.components.securitySchemes.sessionToken, {
      type: 'http', scheme: 'bearer', bearerFormat: 'OpaqueSessionToken',
      description: '由创建会话返回，只存于当前会话上下文，不得写入Skill包或日志。',
    });
    assert.deepEqual(document.paths[`${prefix}/sessions/{id}/map`].get.security, [{ sessionToken: [] }]);
  });
});
