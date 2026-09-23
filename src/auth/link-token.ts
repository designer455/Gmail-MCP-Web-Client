import crypto from 'crypto';
import { getEnv } from '../config/env.js';
import { UnauthorizedError, ValidationError } from '../utils/errors.js';
import { isValidInstallationId } from './installation.js';

interface LinkTokenPayload {
  installationId: string;
  tokenId: string;
  expiresAt: number;
}

// In-memory set of consumed link tokens (replay protection)
const consumedLinkTokenIds = new Set<string>();

export function clearConsumedLinkTokens(): void {
  consumedLinkTokenIds.clear();
}

/**
 * Computes HMAC-SHA256 signature for link tokens
 */
function computeSignature(data: string): string {
  const secret = getEnv().MCP_AUTH_SECRET;
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Creates a signed, single-use, 10-minute Google connection link URL bound to installationId.
 */
export function createGoogleLinkToken(installationId: string, baseUrl?: string): string {
  if (!installationId || typeof installationId !== 'string' || installationId.trim() === '') {
    throw new ValidationError('Installation ID is required for Google linking.');
  }

  if (process.env.NODE_ENV !== 'test' && !isValidInstallationId(installationId)) {
    throw new ValidationError(`Invalid installation ID for Google linking: ${installationId}`);
  }

  const tokenId = crypto.randomUUID();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const payload: LinkTokenPayload = {
    installationId,
    tokenId,
    expiresAt,
  };

  const payloadJson = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = computeSignature(encodedPayload);
  const token = `${encodedPayload}.${signature}`;

  const host = baseUrl || 'https://gmail-mcp-web-client.vercel.app';
  return `${host.replace(/\/+$/, '')}/auth/google/link?token=${token}`;
}

/**
 * Verifies a Google connection link token.
 * Ensures signature validity, expiration check, and single-use replay protection.
 */
export function verifyGoogleLinkToken(token: string): { installationId: string } {
  if (!token || typeof token !== 'string') {
    throw new UnauthorizedError('Missing or invalid connection link token.');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    throw new UnauthorizedError('Malformed connection link token.');
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = computeSignature(encodedPayload);

  // Constant-time signature comparison
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new UnauthorizedError('Invalid connection link token signature.');
  }

  let payload: LinkTokenPayload;
  try {
    const jsonStr = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr) as LinkTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid connection link token payload.');
  }

  if (Date.now() > payload.expiresAt) {
    throw new UnauthorizedError('Connection link token has expired. Please generate a new link.');
  }

  if (consumedLinkTokenIds.has(payload.tokenId)) {
    throw new UnauthorizedError(
      'Connection link token has already been used. Please generate a new link.'
    );
  }

  // Atomically mark token as consumed
  consumedLinkTokenIds.add(payload.tokenId);

  if (!isValidInstallationId(payload.installationId)) {
    throw new UnauthorizedError('Connection link token contains invalid installation identity.');
  }

  return { installationId: payload.installationId };
}
