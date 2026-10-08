import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { DeletionError } from './config';

export const statusTokenValid = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export function sameHash(a: string, b: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  );
}
function key(): Buffer {
  const encoded = process.env.ACCOUNT_DELETION_ENCRYPTION_KEY || '';
  const value = Buffer.from(encoded, 'base64');
  if (value.length !== 32)
    throw new DeletionError('APPLE_CONFIGURATION_REQUIRED');
  return value;
}
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((v) => v.toString('base64url'))
    .join('.');
}
export function decryptSecret(encrypted: string): string {
  const [iv, tag, value] = encrypted
    .split('.')
    .map((v) => Buffer.from(v, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(value), cipher.final()]).toString('utf8');
}
