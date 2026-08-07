import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');

describe('Production container definition', () => {
  it('使用固定Node版本、非root用户和真实健康检查', async () => {
    const dockerfile = await readFile(resolve(root, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /FROM node:22\.14\.0-bookworm-slim AS builder/);
    assert.match(dockerfile, /USER landing/);
    assert.match(dockerfile, /api\/public\/clawhive\/v1\/health/);
    assert.doesNotMatch(dockerfile, /DEEPSEEK_API_KEY\s*=/);
    assert.doesNotMatch(dockerfile, /EXTERNAL_LANDING_FDE_API_KEY\s*=/);
    assert.match(dockerfile, /COPY integrations \.\/integrations/);
  });

  it('生产Compose只绑定回环、根文件系统只读并丢弃Linux capabilities', async () => {
    const source = await readFile(resolve(root, 'compose.yaml'), 'utf8');
    const compose = YAML.parse(source);
    const service = compose.services['enterprise-ai-landing-guide'];
    assert.deepEqual(service.ports, ['127.0.0.1:${EXTERNAL_HOST_PORT:-3020}:3020']);
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.ok(service.volumes.includes('enterprise-ai-landing-data:/app/.runtime'));
    for (const variable of [
      'EXTERNAL_PUBLIC_BASE_URL', 'FDE_ENTERPRISE_ID', 'EXTERNAL_LANDING_FDE_API_KEY',
      'EXTERNAL_DATA_ENCRYPTION_KEY', 'EXTERNAL_STATS_API_KEY', 'DEEPSEEK_API_KEY',
    ]) {
      assert.match(String(service.environment[variable]), /\:\?/);
    }
  });

  it('构建上下文排除密钥、运行库和本地数据', async () => {
    const ignore = await readFile(resolve(root, '.dockerignore'), 'utf8');
    for (const entry of ['node_modules', '.runtime', '.env', '.env.*', '*.sqlite']) {
      assert.match(ignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    }
  });
});
