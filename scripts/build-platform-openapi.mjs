import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = YAML.parse(await readFile(resolve(root, 'integrations/clawhive/openapi.yaml'), 'utf8'));

await build('COZE', 'Coze Enterprise AI Landing Guide API', 'distribution/coze/enterprise-ai-landing-guide/api-plugin-openapi.yaml');
await build('CHATGPT', 'ChatGPT Enterprise AI Landing Guide Actions', 'distribution/chatgpt/enterprise-ai-landing-guide/actions-openapi.yaml');

async function build(platformCode, title, targetPath) {
  const document = structuredClone(source);
  document.info.title = title;
  document.info.description = `${platformCode} 轻量适配契约。只调用统一公开API，不暴露FDE内部接口。`;
  document.components.schemas.CreateSessionRequest.properties.sourcePlatform = { type: 'string', enum: [platformCode], default: platformCode };
  delete document.paths['/api/public/clawhive/v1/sessions/{id}/attachments'];
  document.components.parameters.SessionTokenHeader = {
    name: 'X-Session-Token', in: 'header', required: true,
    description: '创建会话返回的短期不透明Token，只保留于当前对话上下文。',
    schema: { type: 'string', minLength: 20, maxLength: 300 },
  };
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      if (operation.security) {
        delete operation.security;
        operation.parameters = [...(operation.parameters || []), { $ref: '#/components/parameters/SessionTokenHeader' }];
      }
    }
  }
  delete document.components.securitySchemes;
  const target = resolve(root, targetPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, YAML.stringify(document, { lineWidth: 0 }), 'utf8');
}
