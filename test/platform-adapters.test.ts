import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Platform adapters', () => {
  it('ChatGPT Actions只暴露公开路由并固定归因', () => {
    const raw = read('distribution/chatgpt/enterprise-ai-landing-guide/actions-openapi.yaml');
    const document = YAML.parse(raw) as any;
    assert.equal(Object.keys(document.paths).length, 8);
    assert.deepEqual(document.components.schemas.CreateSessionRequest.properties.sourcePlatform.enum, ['CHATGPT']);
    assert.equal(raw.includes('/api/internal/'), false);
    assert.equal(raw.includes('X-External-Landing-Key'), false);
  });

  it('ChatGPT会话Token是动态请求头而不是包内密钥', () => {
    const document = YAML.parse(read('distribution/chatgpt/enterprise-ai-landing-guide/actions-openapi.yaml')) as any;
    assert.equal(document.components.securitySchemes, undefined);
    assert.equal(document.components.parameters.SessionTokenHeader.name, 'X-Session-Token');
    assert.deepEqual(document.paths['/api/public/clawhive/v1/sessions/{id}/map'].get.parameters.at(-1), { $ref: '#/components/parameters/SessionTokenHeader' });
  });

  it('扣子API契约固定COZE且不要求地图前联系方式', () => {
    const document = YAML.parse(read('distribution/coze/enterprise-ai-landing-guide/api-plugin-openapi.yaml')) as any;
    assert.deepEqual(document.components.schemas.CreateSessionRequest.properties.sourcePlatform.enum, ['COZE']);
    const instructions = read('distribution/coze/enterprise-ai-landing-guide/agent-instructions.md');
    assert.match(instructions, /先生成地图/);
    assert.match(instructions, /联系授权/);
  });

  it('Dify manifest与provider完整指向7个工具', () => {
    const manifest = YAML.parse(read('distribution/dify/enterprise-ai-landing-guide-plugin/manifest.yaml')) as any;
    const provider = YAML.parse(read('distribution/dify/enterprise-ai-landing-guide-plugin/provider/enterprise-ai-landing-guide.yaml')) as any;
    assert.equal(manifest.plugins.tools[0], 'provider/enterprise-ai-landing-guide.yaml');
    assert.equal(provider.tools.length, 7);
    assert.ok(provider.tools.every((path: string) => path.startsWith('tools/')));
  });

  it('Dify插件固定DIFY归因且不包含FDE密钥', () => {
    const client = read('distribution/dify/enterprise-ai-landing-guide-plugin/tools/client.py');
    assert.match(client, /"sourcePlatform": "DIFY"/);
    assert.equal(client.includes('EXTERNAL_LANDING_FDE_API_KEY'), false);
    assert.equal(/sk-[A-Za-z0-9_-]{16,}/.test(client), false);
  });

  it('网站来源固定为FDE_WEBSITE且URL只接收campaignCode', () => {
    const app = read('public/app.js');
    const config = JSON.parse(read('distribution/website/enterprise-ai-landing-guide/integration-config.json'));
    assert.match(app, /const sourcePlatform='FDE_WEBSITE'/);
    assert.equal(app.includes("get('sourcePlatform')"), false);
    assert.deepEqual(config.allowedQueryParameters, ['campaignCode']);
  });

  it('有道龙虾文档准确区分适配与平台内验证状态', () => {
    const report = read('distribution/lobster-ai/installation-and-validation/compatibility-report.md');
    assert.match(report, /OpenClaw Skill包 \| 适配完成/);
    assert.match(report, /龙虾平台安装 \| 未开始/);
    assert.match(report, /不虚报上架/);
  });

  it('所有新适配文件不含凭证或Cookie', () => {
    const files = [
      'distribution/chatgpt/enterprise-ai-landing-guide/gpt-instructions.md',
      'distribution/coze/enterprise-ai-landing-guide/agent-instructions.md',
      'distribution/lobster-ai/installation-and-validation/README.md',
      'distribution/website/enterprise-ai-landing-guide/embed.html',
    ];
    for (const file of files) {
      const content = read(file);
      assert.equal(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/.test(content), false, file);
      assert.equal(/cookie\s*[:=]\s*[A-Za-z0-9%]/i.test(content), false, file);
    }
  });
});
