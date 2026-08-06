import { spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'enterprise-ai-landing-guide';
const source = resolve(serviceRoot, 'integrations/clawhive', packageName);
const openApi = resolve(serviceRoot, 'integrations/clawhive/openapi.yaml');
const openClawRoot = resolve(serviceRoot, 'distribution/openclaw');
const destination = resolve(openClawRoot, packageName);
const artifactRoot = resolve(serviceRoot, '../../artifacts/enterprise-ai-landing-guide');
const zipPath = resolve(artifactRoot, `${packageName}-1.0.0.zip`);

await mkdir(source, { recursive: true });
await copyFile(openApi, resolve(source, 'openapi.yaml'));
await rm(destination, { recursive: true, force: true });
await mkdir(openClawRoot, { recursive: true });
await cp(source, destination, { recursive: true });
await mkdir(artifactRoot, { recursive: true });
await rm(zipPath, { force: true });

const zipped = spawnSync('zip', ['-qr', zipPath, packageName], {
  cwd: openClawRoot,
  encoding: 'utf8',
});
if (zipped.status !== 0) {
  throw new Error(`zip failed: ${zipped.stderr || zipped.stdout || `exit ${zipped.status}`}`);
}

const bytes = (await stat(zipPath)).size;
if (bytes > 50 * 1024 * 1024) throw new Error(`Skill package exceeds 50MB: ${bytes}`);
process.stdout.write(`${zipPath}\n${bytes} bytes\n`);
