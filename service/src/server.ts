import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { LandingDatabase } from './db.js';
import { LandingAiError } from './llm.js';
import { ExternalLandingSessionService, LandingServiceError } from './session-service.js';
import { redactForLog, secureEqual } from './security.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(moduleDir, '../public');
const clawHiveOpenApiPath = resolve(moduleDir, '../integrations/clawhive/openapi.yaml');
const clawHiveOpenApi = readFileSync(clawHiveOpenApiPath, 'utf8')
  .replace(/(^servers:\n\s+- url: ).+$/m, `$1${config.publicBaseUrl}`);

export function buildApp(options: { databasePath?: string; service?: ExternalLandingSessionService } = {}) {
  const database = options.service?.db || new LandingDatabase(options.databasePath || config.databasePath);
  const service = options.service || new ExternalLandingSessionService(database);
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'req.headers.x-session-token', 'req.headers.x-external-landing-key', 'req.headers.x-stats-key'],
    },
    bodyLimit: config.maxUploadBytes + 1024 * 1024,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
  });

  app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: '1 minute' });
  app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 8, parts: 9 },
    throwFileSizeLimit: true,
  });
  app.register(fastifyStatic, { root: publicDir, prefix: '/assets/' });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((error: any, request, reply) => {
    const known = error instanceof LandingServiceError || error instanceof LandingAiError;
    const multipartTooLarge = error?.code === 'FST_REQ_FILE_TOO_LARGE';
    const statusCode = multipartTooLarge ? 413 : known ? error.statusCode : (error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    const code = multipartTooLarge ? 'EXT-41300' : known ? error.code : statusCode === 429 ? 'EXT-42900' : statusCode === 400 ? 'EXT-40000' : 'EXT-50000';
    const message = multipartTooLarge
      ? '文件超过允许大小'
      : known ? error.message
        : statusCode === 429 ? '请求过于频繁，请稍后重试'
          : statusCode < 500 ? '请求参数不正确' : '服务暂时不可用，请稍后重试';
    if (statusCode >= 500) request.log.error({ code, message: redactForLog(String(error?.message || error)), requestId: request.id }, 'request failed');
    reply.status(statusCode).send({ code, message, requestId: request.id, timestamp: new Date().toISOString(), data: null });
  });

  const registerPublicRoutes = (prefix: string, fixedSourcePlatform: string, includeOpenApi = false) => {
    app.get(`${prefix}/health`, async () => {
      database.raw.prepare('SELECT 1').get();
      return { status: 'ok' };
    });

    if (includeOpenApi) {
      app.get(`${prefix}/openapi.yaml`, async (_request, reply) => {
        return reply.type('application/yaml; charset=utf-8').send(clawHiveOpenApi);
      });
    }

    app.post(`${prefix}/sessions`, async (request, reply) => {
      // Attribution is a property of the entry route, never user-provided data.
      const result = service.createSession({ ...asObject(request.body), sourcePlatform: fixedSourcePlatform });
      return reply.status(201).send(result);
    });

    app.post(`${prefix}/sessions/:id/messages`, async (request) => {
      return service.addMessage(paramId(request), sessionToken(request), asObject(request.body), idempotencyKey(request));
    });

    app.post(`${prefix}/sessions/:id/attachments`, async (request) => {
      const part = await request.file();
      if (!part) throw new LandingServiceError('EXT-40030', '缺少上传文件', 400);
      const buffer = await part.toBuffer();
      return service.addAttachment(paramId(request), sessionToken(request), {
        filename: part.filename, mimetype: part.mimetype, buffer,
      }, idempotencyKey(request));
    });

    app.post(`${prefix}/sessions/:id/generate-map`, async (request) => {
      return service.generateMap(paramId(request), sessionToken(request), idempotencyKey(request));
    });

    app.get(`${prefix}/sessions/:id/map`, async (request) => {
      return service.getMap(paramId(request), sessionToken(request));
    });

    app.post(`${prefix}/sessions/:id/consent`, async (request) => {
      return service.saveConsent(paramId(request), sessionToken(request), asObject(request.body), idempotencyKey(request));
    });

    app.post(`${prefix}/sessions/:id/convert`, async (request) => {
      return service.convert(paramId(request), sessionToken(request), idempotencyKey(request));
    });

    app.delete(`${prefix}/sessions/:id`, async (request) => {
      return service.deleteSession(paramId(request), sessionToken(request));
    });
  };

  registerPublicRoutes('/api/public/clawhive/v1', 'CLAWHIVE', true);
  registerPublicRoutes('/api/public/fde-website/v1', 'FDE_WEBSITE');

  app.get('/api/internal/enterprise-ai-landing-guide/v1/stats', async (request) => {
    const supplied = String(request.headers['x-stats-key'] || '');
    if (config.statsApiKey.length < 32 || !secureEqual(config.statsApiKey, supplied)) {
      throw new LandingServiceError('EXT-40180', '统计服务凭证无效', 401);
    }
    return service.statistics(asObject(request.query));
  });

  app.get('/', (_request, reply) => reply.sendFile('index.html'));
  app.get('/enterprise-ai-landing-guide', (_request, reply) => reply.sendFile('index.html'));
  app.get('/legal/clawhive/privacy', (_request, reply) => reply.type('text/html; charset=utf-8').send(privacyHtml()));
  app.get('/legal/clawhive/terms', (_request, reply) => reply.type('text/html; charset=utf-8').send(termsHtml()));

  const cleanupTimer = setInterval(() => service.cleanupExpired().catch((error) => app.log.error({ message: redactForLog(String(error)) }, 'cleanup failed')), 60 * 60 * 1000);
  cleanupTimer.unref();
  app.addHook('onClose', async () => { clearInterval(cleanupTimer); database.close(); });
  return app;
}

async function main() {
  const app = buildApp();
  await app.listen({ host: config.host, port: config.port });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Failed to start enterprise AI landing guide: ${redactForLog(String(error?.message || error))}\n`);
    process.exitCode = 1;
  });
}

function paramId(request: FastifyRequest) {
  return String((request.params as any)?.id || '');
}

function sessionToken(request: FastifyRequest) {
  const direct = String(request.headers['x-session-token'] || '');
  if (direct) return direct;
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function idempotencyKey(request: FastifyRequest) {
  return String(request.headers['idempotency-key'] || '');
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.75;color:#172036;max-width:860px;margin:0 auto;padding:40px 22px;background:#f6f8fb}main{background:#fff;border:1px solid #e5e9f2;border-radius:18px;padding:32px}h1{font-size:30px}h2{margin-top:28px}a{color:#2458d3}</style></head><body><main><a href="/enterprise-ai-landing-guide">← 返回企业AI落地导航</a><h1>${title}</h1>${body}</main></body></html>`;
}

function privacyHtml() {
  return page('企业AI落地导航隐私说明', `
    <p>生效日期：2026年8月6日</p>
    <h2>我们处理什么信息</h2><p>为生成企业AI落地地图，服务会处理你主动输入的企业行业、规模、角色、业务问题、流程、影响和上传资料。只有你明确同意保存时，才会把地图和企业名称发送到蓝图FDE；只有你另行同意联系时，才会发送并创建联系人。</p>
    <h2>使用目的</h2><p>信息仅用于生成落地地图、提供7天验证建议，以及在你申请人工复核后创建客户或匹配客户、联系人、商机、诊断拜访和跟进任务。</p>
    <h2>保留与删除</h2><p>匿名会话和临时附件默认保留30天（以服务端配置为准），你可以在会话内主动删除。转换后的正式FDE业务数据遵循FDE已有保留规则。</p>
    <h2>请勿上传</h2><p>请不要上传国家秘密、商业核心机密、个人敏感信息或你无权处理的数据。</p>
    <h2>AI边界</h2><p>AI结果仅供业务评估，不构成收益保证。信息不足处会标记为待确认，正式实施仍需人工复核。</p>
    <h2>联系我们</h2><p>未授权联系时，系统不会创建联系人。需要删除匿名数据时，请使用当前会话中的删除功能。</p>
  `);
}

function termsHtml() {
  return page('企业AI落地导航服务条款', `
    <p>生效日期：2026年8月6日</p>
    <h2>服务范围</h2><p>本服务帮助企业识别一个优先AI场景、AI介入流程、员工保留职责和7天验证计划，不是万能企业诊断，也不自动完成企业AI转型。</p>
    <h2>用户责任</h2><p>你应确保提交的信息和资料真实、合法且有权处理；不得利用本服务上传恶意文件、探测内部系统或绕过授权。</p>
    <h2>结果边界</h2><p>本服务不保证降本增效、成交或其他商业结果，不替代企业管理者、财务、法律、安全或行业专业人员的判断。</p>
    <h2>人工确认</h2><p>AI不会自动正式对外报价、投标、推荐信息不足的商品或替代最终决策。所有正式实施动作应由员工确认。</p>
  `);
}
