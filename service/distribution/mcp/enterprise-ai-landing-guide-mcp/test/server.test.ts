import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLandingMcpServer } from '../src/server.js';

const expectedTools = [
  'start_ai_landing_session',
  'answer_ai_landing_question',
  'upload_ai_landing_attachment',
  'generate_ai_landing_map',
  'get_ai_landing_map',
  'request_human_fde_review',
  'delete_ai_landing_session',
];

class FakeCoreClient {
  calls: string[] = [];
  create(input: Record<string, unknown>) { this.calls.push('create'); return Promise.resolve({ sessionId: '00000000-0000-4000-8000-000000000001', sessionToken: 'elag_fake_session_token_1234567890', ...input }); }
  answer() { this.calls.push('answer'); return Promise.resolve({ nextQuestion: '这个流程每月发生多少次？' }); }
  generate() { this.calls.push('generate'); return Promise.resolve({ currentStage: 'MAP_READY', markdown: '# 企业AI落地地图' }); }
  map() { this.calls.push('map'); return Promise.resolve({ currentStage: 'MAP_READY' }); }
  consent() { this.calls.push('consent'); return Promise.resolve({ canConvert: true }); }
  convert() { this.calls.push('convert'); return Promise.resolve({ opportunityId: 'opportunity-1', visitId: 'visit-1' }); }
  delete() { this.calls.push('delete'); return Promise.resolve({ deleted: true }); }
}

async function memoryClient(fake = new FakeCoreClient()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createLandingMcpServer(fake as any);
  const client = new Client({ name: 'mcp-adapter-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, fake };
}

describe('Enterprise AI Landing Guide MCP', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.allSettled(closers.splice(0).map((close) => close())); });

  it('只暴露指定的7个落地导航工具', async () => {
    const { client, server } = await memoryClient();
    closers.push(() => client.close(), () => server.close());
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...expectedTools].sort());
    assert.equal(tools.tools.some((tool) => /database|filesystem|admin/i.test(tool.name)), false);
  });

  it('创建会话保留MCP来源平台', async () => {
    const { client, server, fake } = await memoryClient();
    closers.push(() => client.close(), () => server.close());
    const response = await client.callTool({
      name: 'start_ai_landing_session',
      arguments: { sourcePlatform: 'SMITHERY', sourceVersion: '1.0.0', externalSessionId: 'mcp-test-1', mode: 'KNOWN_PROBLEM' },
    });
    assert.equal(response.isError, undefined);
    assert.equal((response.structuredContent as any).result.sourcePlatform, 'SMITHERY');
    assert.deepEqual(fake.calls, ['create']);
  });

  it('拒绝非允许来源平台', async () => {
    const { client, server, fake } = await memoryClient();
    closers.push(() => client.close(), () => server.close());
    const response = await client.callTool({
      name: 'start_ai_landing_session',
      arguments: { sourcePlatform: 'FORGED', sourceVersion: '1.0.0', externalSessionId: 'mcp-test-2' },
    });
    assert.equal(response.isError, true);
    assert.deepEqual(fake.calls, []);
  });

  it('人工复核工具先保存授权再转换', async () => {
    const { client, server, fake } = await memoryClient();
    closers.push(() => client.close(), () => server.close());
    const response = await client.callTool({
      name: 'request_human_fde_review',
      arguments: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        sessionToken: 'elag_fake_session_token_1234567890',
        consentToStore: true,
        consentToContact: false,
        companyName: '安全测试企业',
        idempotencyKey: 'review-test-001',
      },
    });
    assert.equal(response.isError, undefined);
    assert.deepEqual(fake.calls, ['consent', 'convert']);
  });

  it('远程Streamable HTTP端点可真实initialize并列出工具', async () => {
    process.env.MCP_ACCESS_TOKEN = 'mcp-test-access-token-with-at-least-32-characters';
    process.env.MCP_ALLOWED_HOSTS = 'localhost,127.0.0.1';
    process.env.MCP_ALLOWED_ORIGINS = 'localhost,127.0.0.1';
    const { buildHttpApp } = await import(`../src/http.js?test=${Date.now()}`);
    const listener = buildHttpApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_ACCESS_TOKEN}` } },
    });
    const client = new Client({ name: 'remote-mcp-test', version: '1.0.0' });
    closers.push(() => client.close(), () => new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())));
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...expectedTools].sort());
  });
});
