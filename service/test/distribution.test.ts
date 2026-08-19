import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, it } from 'node:test';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const packageName = 'enterprise-ai-landing-guide';
const canonical = resolve(root, 'integrations/clawhive', packageName);
const openClaw = resolve(root, 'distribution/openclaw', packageName);
const submission = resolve(root, '../artifacts/clawhive-submission');
const required = [
  'SKILL.md', 'README.md', 'PRIVACY.md', 'CHANGELOG.md', 'LICENSE', 'openapi.yaml', 'scripts/fde_client.py',
  'references/output-schema.md', 'references/privacy-notice.md', 'references/usage-boundaries.md',
  'examples/manufacturing-quotation.md', 'examples/ecommerce-customer-service.md', 'examples/bidding-process.md',
  'assets/listing-copy.md', 'assets/icon-requirements.md', 'assets/submission-checklist.md',
];

function treeBytes(path: string): number {
  const stat = statSync(path);
  if (stat.isFile()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + treeBytes(resolve(path, name)), 0);
}

describe('Skill distribution package', () => {
  it('同时产出ClawHive和OpenClaw独立包', () => {
    for (const base of [canonical, openClaw]) {
      for (const file of required) assert.equal(existsSync(resolve(base, file)), true, `${base}/${file}`);
    }
  });

  it('SKILL名称与小写连字符目录一致', () => {
    const skill = readFileSync(resolve(canonical, 'SKILL.md'), 'utf8');
    const name = skill.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    assert.equal(name, basename(canonical));
    assert.match(name || '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(skill, /^description:\s*.+$/m);
    assert.match(skill, /^allowed-tools:\s*Bash\(python3:\*\)$/m);
  });

  it('发布包OpenAPI与唯一公开契约字节一致', () => {
    const source = readFileSync(resolve(root, 'integrations/clawhive/openapi.yaml'));
    assert.deepEqual(readFileSync(resolve(canonical, 'openapi.yaml')), source);
    assert.deepEqual(readFileSync(resolve(openClaw, 'openapi.yaml')), source);
  });

  it('公开OpenAPI只使用会话Token且不暴露FDE内部凭证', () => {
    const raw = readFileSync(resolve(canonical, 'openapi.yaml'), 'utf8');
    const document = YAML.parse(raw) as any;
    assert.equal(raw.includes('X-External-Landing-Key'), false);
    assert.equal(raw.includes('/api/internal/'), false);
    assert.equal(document.components.securitySchemes.sessionToken.scheme, 'bearer');
  });

  it('所有主要平台均在统一来源配置中启用', () => {
    const config = YAML.parse(readFileSync(resolve(root, 'distribution/platforms.yaml'), 'utf8')) as any;
    const enabled = new Set(config.platforms.filter((item: any) => item.enabled).map((item: any) => item.platformCode));
    for (const platform of ['CLAWHUB', 'CLAWHIVE', 'LOBSTER_AI', 'COZE', 'CHATGPT', 'DIFY', 'SMITHERY', 'GLAMA', 'MODELSCOPE', 'FDE_WEBSITE']) {
      assert.equal(enabled.has(platform), true, platform);
    }
  });

  it('Python客户端无第三方依赖且不提供明文Token参数', () => {
    const client = resolve(canonical, 'scripts/fde_client.py');
    const help = spawnSync('python3', [client, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.equal(help.stdout.includes('--token'), false);
    const raw = readFileSync(client, 'utf8');
    assert.equal(/\b(requests|httpx|aiohttp)\b/.test(raw), false);
    assert.equal(/sk-[A-Za-z0-9]{16,}/.test(raw), false);
  });

  it('三个样例都明示员工保留职责或自动化停止边界', () => {
    const exampleDir = resolve(canonical, 'examples');
    const files = ['manufacturing-quotation.md', 'ecommerce-customer-service.md', 'bidding-process.md'];
    for (const file of files) {
      const content = readFileSync(resolve(exampleDir, file), 'utf8');
      assert.match(content, /员工保留职责|停止边界/);
      assert.match(content, /7天验证/);
    }
  });

  it('发布包远小于ClawHub 50MB上限', () => {
    assert.ok(treeBytes(openClaw) < 50 * 1024 * 1024);
  });

  it('参赛和市场提交材料齐全且状态可核验', () => {
    const files = [
      'skill-name.txt', 'slug.txt', 'short-description.txt', 'full-description.md', 'tags.txt',
      'originality-statement.md', 'privacy-summary.md', 'usage-boundaries.md', 'submission-checklist.md',
      'review-notes.md', 'demo-script.md', 'cover-copy.md',
    ];
    for (const file of files) assert.equal(existsSync(resolve(submission, file)), true, file);
    assert.equal(readFileSync(resolve(submission, 'slug.txt'), 'utf8').trim(), packageName);
    const checklist = readFileSync(resolve(submission, 'submission-checklist.md'), 'utf8');
    assert.match(checklist, /当前状态：作品材料已完成；等待官方报名入口/);
    assert.match(checklist, /\[x\] 公网 HTTPS API/);
    assert.match(checklist, /\[x\] ClawHub v1\.0\.0 已公开上架/);
    assert.match(checklist, /\[ \] ClawHive 平台内三套对话复演：当前企业桌面\/云端坐席均为 0/);
    assert.match(checklist, /\[ \] 获得主办方可核验的官方报名表/);
  });
});
