import { spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'enterprise-ai-landing-guide';
const releaseVersion = '1.3.1';
const source = resolve(serviceRoot, 'integrations/clawhive', packageName);
const openApi = resolve(serviceRoot, 'integrations/clawhive/openapi.yaml');
const openClawRoot = resolve(serviceRoot, 'distribution/openclaw');
const destination = resolve(openClawRoot, packageName);
const artifactRoot = resolve(serviceRoot, '../../artifacts/enterprise-ai-landing-guide');
const zipPath = resolve(artifactRoot, `${packageName}-${releaseVersion}.zip`);

await mkdir(source, { recursive: true });
await copyFile(openApi, resolve(source, 'openapi.yaml'));
for (const [from, to] of [
  ['references/OUTPUT.md', 'references/output-schema.md'],
  ['PRIVACY.md', 'references/privacy-notice.md'],
  ['examples/01-manufacturing-quotation.md', 'examples/manufacturing-quotation.md'],
  ['examples/02-ecommerce-presales.md', 'examples/ecommerce-customer-service.md'],
  ['examples/03-tender-screening.md', 'examples/bidding-process.md'],
]) {
  await mkdir(dirname(resolve(source, to)), { recursive: true });
  await copyFile(resolve(source, from), resolve(source, to));
}
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
