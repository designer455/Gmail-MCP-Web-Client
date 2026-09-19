import crypto from 'crypto';
import { getEnv } from '../config/env.js';
import { InvalidOAuthStateError, ExpiredOAuthStateError } from '../utils/errors.js';

// State expiration time: 10 minutes
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Replay protection: cache consumed nonces
const consumedNonces = new Set<string>();

export interface OAuthStatePayload {
  userId: string;
  timestamp: number;
  nonce: string;
  redirectUrl?: string;
}

/**
 * Computes HMAC-SHA256 signature for a state payload
 */
function computeSignature(payloadString: string, secret?: string): string {
  const signingKey = secret || getEnv().MCP_AUTH_SECRET;
  return crypto.createHmac('sha256', signingKey).update(payloadString).digest('hex');
}

/**
 * Generates a tamper-proof, time-limited OAuth state parameter.
 * Contains no secrets. Includes CSRF nonce and HMAC signature.
 */
export function generateOAuthState(
  userId: string,
  redirectUrl?: string,
  overrideSecret?: string
): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();

  const payload: OAuthStatePayload = {
    userId,
    timestamp,
    nonce,
    redirectUrl,
  };

  const payloadString = JSON.stringify(payload);
  const signature = computeSignature(payloadString, overrideSecret);

  // Return base64url-encoded package: payload + '.' + signature
  const encodedPayload = Buffer.from(payloadString, 'utf8').toString('base64url');
  return `${encodedPayload}.${signature}`;
}

/**
 * Validates the OAuth state returned in the OAuth callback.
 * Checks signature, expiration, and replay protection.
 */
export function validateOAuthState(
  stateString: string,
  overrideSecret?: string
): OAuthStatePayload {
  if (!stateString || typeof stateString !== 'string') {
    throw new InvalidOAuthStateError('Missing or malformed OAuth state.');
  }

  const parts = stateString.split('.');
  if (parts.length !== 2) {
    throw new InvalidOAuthStateError('Invalid OAuth state structure.');
  }

  const [encodedPayload, signature] = parts;

  let payloadString: string;
  let payload: OAuthStatePayload;
  try {
    payloadString = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    payload = JSON.parse(payloadString) as OAuthStatePayload;
  } catch {
    throw new InvalidOAuthStateError('Failed to parse OAuth state payload.');
  }

  if (!payload.userId || !payload.timestamp || !payload.nonce) {
    throw new InvalidOAuthStateError('Incomplete OAuth state payload.');
  }

  // 1. Verify cryptographic signature
  const expectedSignature = computeSignature(payloadString, overrideSecret);
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new InvalidOAuthStateError(
      'OAuth state signature verification failed. Possible tampering.'
    );
  }

  // 2. Verify state expiration
  const now = Date.now();
  if (now < payload.timestamp - 5000) {
    throw new InvalidOAuthStateError('OAuth state timestamp is in the future.');
  }
  if (now - payload.timestamp > STATE_MAX_AGE_MS) {
    throw new ExpiredOAuthStateError('OAuth state has expired.');
  }

  // 3. Prevent replay attacks
  if (consumedNonces.has(payload.nonce)) {
    throw new InvalidOAuthStateError('OAuth state has already been used.');
  }

  // Mark nonce as consumed
  consumedNonces.add(payload.nonce);

  // Periodically clean up old nonces (keep memory bounded)
  if (consumedNonces.size > 10000) {
    consumedNonces.clear();
  }

  return payload;
}

/**
 * Helper to reset consumed nonces (for testing)
 */
export function clearConsumedNonces(): void {
  consumedNonces.clear();
}
