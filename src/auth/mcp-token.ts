import * as jose from 'jose';
import { getEnv } from '../config/env.js';
import { UnauthorizedError } from '../utils/errors.js';
import { isValidInstallationId } from './installation.js';
import { logger } from '../utils/logger.js';

/**
 * Derives a symmetric key buffer for HS256 signing of MCP Bearer tokens.
 */
function getSigningKey(): Uint8Array {
  const secret = getEnv().MCP_AUTH_SECRET;
  return new TextEncoder().encode(secret);
}

export interface McpTokenPayload {
  installationId: string;
  claims: jose.JWTPayload;
}

/**
 * Creates our own cryptographically signed MCP Bearer access token for ChatGPT.
 *
 * Guarantees:
 * - Signed with HMAC-SHA256 (HS256) via jose using MCP_AUTH_SECRET
 * - Subject ('sub') strictly holds the installationId ('gm_...')
 * - Expiration: 1 hour default
 * - NEVER contains Google access tokens, Google refresh tokens, passwords, or encryption keys
 */
export async function createMcpAccessToken(
  installationId: string,
  options?: { expiresInSeconds?: number; audience?: string }
): Promise<string> {
  if (!isValidInstallationId(installationId)) {
    throw new Error(`Invalid installation ID for MCP token generation: ${installationId}`);
  }

  const key = getSigningKey();
  const expiresIn = options?.expiresInSeconds ?? 3600;
  const audience = options?.audience ?? 'mcp-client';

  const jwt = await new jose.SignJWT({
    installationId,
    tokenType: 'mcp_access_token',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(installationId)
    .setAudience(audience)
    .setIssuer('gmail-mcp-server')
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(key);

  return jwt;
}

/**
 * Cryptographically verifies an incoming MCP Bearer access token and extracts the installationId.
 */
export async function verifyMcpAccessToken(token: string): Promise<McpTokenPayload> {
  if (!token || typeof token !== 'string') {
    throw new UnauthorizedError('Missing or empty authentication token.');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Malformed JWT token structure.');
  }

  const key = getSigningKey();

  try {
    const { payload } = await jose.jwtVerify(token, key, {
      algorithms: ['HS256'],
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedError('MCP access token missing subject (sub) claim.');
    }

    const installationId = payload.sub.trim();
    if (!isValidInstallationId(installationId)) {
      throw new UnauthorizedError('MCP access token contains invalid installation identifier.');
    }

    return {
      installationId,
      claims: payload,
    };
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) throw err;

    if (err instanceof jose.errors.JWTExpired) {
      logger.warn('MCP access token verification failed: token has expired');
      throw new UnauthorizedError('Authentication token has expired.');
    }

    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger.warn('MCP access token verification failed: invalid signature');
      throw new UnauthorizedError('Invalid token signature.');
    }

    logger.warn('MCP access token verification failed with error');
    throw new UnauthorizedError('Authentication token is invalid.');
  }
}
