import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import YAML from 'yaml';

dotenv.config();

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(moduleDir, '..');

export interface PlatformConfig {
  platformCode: string;
  displayName: string;
  sourceChannel: string;
  authenticationMode: string;
  supportsAttachments: boolean;
  supportsMarkdown: boolean;
  supportsStructuredOutput: boolean;
  supportsExternalLinks: boolean;
  supportsOAuth: boolean;
  supportsMarketplacePublishing: boolean;
  maxResponseLength: number;
  privacyUrl: string;
  termsUrl: string;
  enabled: boolean;
}

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function configuredPath(name: string, fallback: string) {
  const value = process.env[name]?.trim() || fallback;
  return resolve(projectRoot, value);
}

const platformPath = resolve(projectRoot, 'distribution/platforms.yaml');
if (!existsSync(platformPath)) throw new Error(`Platform configuration missing: ${platformPath}`);
const parsedPlatforms = YAML.parse(readFileSync(platformPath, 'utf8')) as { platforms?: PlatformConfig[] };
const platforms = new Map((parsedPlatforms.platforms || []).map((item) => [item.platformCode, Object.freeze(item)]));

export const config = Object.freeze({
  host: process.env.HOST?.trim() || '127.0.0.1',
  port: integer('PORT', 3020, 1, 65535),
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  publicBaseUrl: (process.env.EXTERNAL_PUBLIC_BASE_URL || 'http://127.0.0.1:3020').replace(/\/$/, ''),
  databasePath: configuredPath('EXTERNAL_DATABASE_PATH', '.runtime/enterprise-ai-landing-guide.sqlite'),
  uploadDir: configuredPath('EXTERNAL_UPLOAD_DIR', '.runtime/uploads'),
  retentionDays: integer('EXTERNAL_SKILL_RETENTION_DAYS', 30, 1, 365),
  sessionTtlMinutes: integer('EXTERNAL_SESSION_TTL_MINUTES', 120, 5, 1440),
  maxUploadBytes: integer('EXTERNAL_MAX_UPLOAD_MB', 10, 1, 50) * 1024 * 1024,
  rateLimitPerMinute: integer('EXTERNAL_RATE_LIMIT_PER_MINUTE', 60, 5, 1000),
  fdeApiBase: (process.env.FDE_API_BASE || 'http://127.0.0.1:3001/api').replace(/\/$/, ''),
  fdeEnterpriseId: process.env.FDE_ENTERPRISE_ID?.trim() || '',
  fdeApiKey: process.env.EXTERNAL_LANDING_FDE_API_KEY || '',
  dataEncryptionKey: process.env.EXTERNAL_DATA_ENCRYPTION_KEY || '',
  statsApiKey: process.env.EXTERNAL_STATS_API_KEY || '',
  defaultAiModel: process.env.DEFAULT_AI_MODEL?.trim() || '',
  deepseekApiUrl: process.env.DEEPSEEK_API_URL?.trim() || 'https://api.deepseek.com/v1/chat/completions',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  conversationLlmTimeoutMs: integer('CONVERSATION_LLM_TIMEOUT_MS', 8000, 1000, 30000),
  llmTimeoutMs: integer('LLM_TIMEOUT_MS', 90000, 5000, 180000),
  testProviderEnabled: process.env.EXTERNAL_LANDING_TEST_PROVIDER === 'true' && process.env.NODE_ENV === 'test',
});

export function getPlatform(platformCode: string) {
  const platform = platforms.get(String(platformCode || '').toUpperCase());
  if (!platform?.enabled) return null;
  return platform;
}

export function enabledPlatforms() {
  return Array.from(platforms.values()).filter((item) => item.enabled);
}
