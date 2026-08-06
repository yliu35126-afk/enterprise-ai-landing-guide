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
const required = ['SKILL.md', 'README.md', 'PRIVACY.md', 'CHANGELOG.md', 'LICENSE', 'openapi.yaml', 'scripts/fde_client.py'];

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
    const files = readdirSync(exampleDir).filter((name) => name.endsWith('.md'));
    assert.equal(files.length, 3);
    for (const file of files) {
      const content = readFileSync(resolve(exampleDir, file), 'utf8');
      assert.match(content, /员工保留职责|停止边界/);
      assert.match(content, /7天验证/);
    }
  });

  it('发布包远小于ClawHub 50MB上限', () => {
    assert.ok(treeBytes(openClaw) < 50 * 1024 * 1024);
  });
});
