import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CoreApiError, LandingCoreClient } from './core-client.js';

const platform = z.enum(['CLAWHUB', 'CLAWHIVE', 'LOBSTER_AI', 'COZE', 'CHATGPT', 'DIFY', 'SMITHERY', 'GLAMA', 'MODELSCOPE', 'FDE_WEBSITE']);
const mode = z.enum(['KNOWN_PROBLEM', 'OPPORTUNITY_SCAN']);
const sessionId = z.string().uuid().describe('创建会话返回的匿名会话ID');
const sessionToken = z.string().min(20).max(300).describe('当前匿名会话的短期Token，不得写入日志或持久化');
const idempotencyKey = z.string().min(8).max(128).describe('该逻辑写操作的幂等键；同请求重试必须复用');
const resultSchema = z.object({ result: z.record(z.string(), z.unknown()) });

function toolResult(result: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: { result },
  };
}

function errorResult(error: unknown) {
  const safe = error instanceof CoreApiError
    ? { code: error.code, message: error.message, status: error.status }
    : { code: 'MCP-UNEXPECTED', message: '工具暂时执行失败' };
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(safe) }],
  };
}

export function createLandingMcpServer(client = new LandingCoreClient()) {
  const server = new McpServer({ name: 'enterprise-ai-landing-guide-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.registerTool('start_ai_landing_session', {
    title: '开始企业AI落地导航',
    description: '创建匿名会话。不会向FDE创建客户或商机。',
    inputSchema: z.object({
      sourcePlatform: platform,
      sourceVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
      externalSessionId: z.string().min(1).max(128),
      mode: mode.optional(),
      campaignCode: z.string().max(100).optional(),
      referrer: z.string().max(500).optional(),
      entryUrl: z.string().max(1000).optional(),
    }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (input) => {
    try { return toolResult(await client.create(input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool('answer_ai_landing_question', {
    title: '回答一轮落地问题',
    description: '提交一条用户回答，并只获取一个下一问题。',
    inputSchema: z.object({ sessionId, sessionToken, message: z.string().min(1).max(4000), mode: mode.optional(), idempotencyKey }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ sessionId, sessionToken, message, mode, idempotencyKey }) => {
    try { return toolResult(await client.answer(sessionId, sessionToken, { message, ...(mode ? { mode } : {}) }, idempotencyKey)); } catch (error) { return errorResult(error); }
  });

  server.registerTool('upload_ai_landing_attachment', {
    title: '添加落地导航资料',
    description: '当前远程MCP版不接收本地文件路径。返回明确限制，请改用文本问答或支持上传的平台适配层。',
    inputSchema: z.object({ sessionId, sessionToken, filename: z.string().min(1).max(200) }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => toolResult({ parseStatus: 'UNSUPPORTED_IN_REMOTE_MCP', message: '远程MCP不接收任意本地路径；请继续文本问答' }));

  server.registerTool('generate_ai_landing_map', {
    title: '生成企业AI落地地图',
    description: '生成严格结构化JSON和Markdown。没有用户回答时不可调用。',
    inputSchema: z.object({ sessionId, sessionToken, idempotencyKey }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ sessionId, sessionToken, idempotencyKey }) => {
    try { return toolResult(await client.generate(sessionId, sessionToken, idempotencyKey)); } catch (error) { return errorResult(error); }
  });

  server.registerTool('get_ai_landing_map', {
    title: '读取企业AI落地地图',
    description: '读取已生成地图，不产生新写入。',
    inputSchema: z.object({ sessionId, sessionToken }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ sessionId, sessionToken }) => {
    try { return toolResult(await client.map(sessionId, sessionToken)); } catch (error) { return errorResult(error); }
  });

  server.registerTool('request_human_fde_review', {
    title: '申请FDE人工复核',
    description: '仅在用户已获得地图、明确同意保存后调用。同意联系是另一选项。',
    inputSchema: z.object({
      sessionId,
      sessionToken,
      consentToStore: z.literal(true),
      consentToContact: z.boolean(),
      companyName: z.string().min(1).max(200),
      contactName: z.string().max(100).optional(),
      mobile: z.string().max(20).optional(),
      email: z.string().email().max(200).optional(),
      idempotencyKey,
    }).superRefine((value, ctx) => {
      if (value.consentToContact && (!value.contactName || (!value.mobile && !value.email))) {
        ctx.addIssue({ code: 'custom', message: '同意联系时需要联系人姓名和手机或邮箱' });
      }
    }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ sessionId, sessionToken, idempotencyKey, ...consent }) => {
    try {
      await client.consent(sessionId, sessionToken, consent, idempotencyKey);
      return toolResult(await client.convert(sessionId, sessionToken, idempotencyKey));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('delete_ai_landing_session', {
    title: '删除匿名落地会话',
    description: '删除匿名会话和临时附件。已授权转换的FDE正式业务数据按FDE规则保留。',
    inputSchema: z.object({ sessionId, sessionToken }),
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ sessionId, sessionToken }) => {
    try { return toolResult(await client.delete(sessionId, sessionToken)); } catch (error) { return errorResult(error); }
  });

  return server;
}
