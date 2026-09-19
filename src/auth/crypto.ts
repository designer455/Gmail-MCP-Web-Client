import crypto from 'crypto';
import { getEnv } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a consistent 32-byte key from ENCRYPTION_KEY
 */
function getDerivedKey(rawKey?: string): Buffer {
  const keySource = rawKey || getEnv().ENCRYPTION_KEY;
  return crypto.createHash('sha256').update(keySource).digest();
}

/**
 * Encrypts a plaintext string into a secure serialized format:
 * Format: `${iv_hex}:${authTag_hex}:${cipherText_hex}`
 */
export function encryptData(plaintext: string, overrideKey?: string): string {
  const key = getDerivedKey(overrideKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a previously encrypted data string.
 */
export function decryptData(encryptedPayload: string, overrideKey?: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, cipherTextHex] = parts;
  const key = getDerivedKey(overrideKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Utility to encrypt a JSON-serializable credential object
 */
export function encryptCredentials<T>(credentials: T, overrideKey?: string): string {
  const serialized = JSON.stringify(credentials);
  return encryptData(serialized, overrideKey);
}

/**
 * Utility to decrypt a serialized credential object back into typed object
 */
export function decryptCredentials<T>(encryptedPayload: string, overrideKey?: string): T {
  const decrypted = decryptData(encryptedPayload, overrideKey);
  return JSON.parse(decrypted) as T;
}
