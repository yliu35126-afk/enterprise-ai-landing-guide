import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function randomToken(prefix = 'elag') {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function encryptionKey() {
  if (!config.dataEncryptionKey) throw new Error('EXTERNAL_DATA_ENCRYPTION_KEY is not configured');
  const decoded = Buffer.from(config.dataEncryptionKey, 'base64');
  if (decoded.length !== 32) throw new Error('EXTERNAL_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return decoded;
}

export function encryptSensitive(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSensitive(value?: string | null) {
  if (!value) return null;
  const [ivPart, tagPart, encryptedPart] = value.split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Encrypted value is malformed');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function sanitizeText(value: unknown, maxLength: number) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function redactForLog(value: string) {
  return value
    .replace(/\b1[3-9]\d{9}\b/g, '[PHONE]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?:Bearer\s+|elag_|fde_)[A-Za-z0-9._-]+/gi, '[TOKEN]');
}
