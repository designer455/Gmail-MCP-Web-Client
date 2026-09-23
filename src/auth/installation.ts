import crypto from 'crypto';

/**
 * Generates an application-owned, cryptographically secure, random opaque installation ID.
 * Format: gm_<32-hex-characters>
 *
 * Rules:
 * - Must NOT be derived from email, Google account ID, IP address, or client ID.
 * - Does NOT contain any PII.
 */
export function generateInstallationId(): string {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `gm_${randomBytes}`;
}

/**
 * Validates the format of an installation ID.
 */
export function isValidInstallationId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return /^gm_[0-9a-f]{32}$/i.test(id.trim());
}
