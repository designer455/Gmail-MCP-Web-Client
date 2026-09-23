import * as jose from 'jose';
import { getEnv } from '../config/env.js';
import { UnauthorizedError } from '../utils/errors.js';
import { verifyMcpAccessToken } from './mcp-token.js';

export interface VerifiedJwtUser {
  userId: string;
  email?: string;
  claims: jose.JWTPayload;
}

export interface JwtVerifyOptions {
  issuer?: string;
  audience?: string | string[];
}

export type JwkKeyResolver = Parameters<typeof jose.jwtVerify>[1];

// Test hook for custom key resolver (e.g. test key pair in unit tests)
let testKeyResolver: JwkKeyResolver | null = null;

export function setTestKeyResolver(resolver: JwkKeyResolver | null): void {
  testKeyResolver = resolver;
}

export function clearJwksCache(): void {
  testKeyResolver = null;
}

export function getKeyResolver(): JwkKeyResolver {
  if (testKeyResolver) {
    return testKeyResolver;
  }
  return new TextEncoder().encode(getEnv().MCP_AUTH_SECRET);
}

/**
 * Cryptographically verifies an incoming MCP Bearer JWT.
 * Uses our own server-signed key (MCP_AUTH_SECRET) or testKeyResolver in test suites.
 *
 * Validates:
 * - Signature
 * - Expiration (exp)
 * - Subject (sub): contains the installation identity (gm_...)
 */
export async function verifyJwt(
  token: string,
  options?: JwtVerifyOptions
): Promise<VerifiedJwtUser> {
  if (!token || typeof token !== 'string') {
    throw new UnauthorizedError('Missing or empty authentication token.');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Malformed JWT token structure.');
  }

  // If a test key resolver is set (e.g. during specific unit tests), use jose.jwtVerify
  if (testKeyResolver) {
    try {
      const verifyOptions: jose.JWTVerifyOptions = {};
      if (options?.issuer) verifyOptions.issuer = options.issuer;
      if (options?.audience) verifyOptions.audience = options.audience;

      const { payload } = await jose.jwtVerify(token, testKeyResolver, verifyOptions);

      if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
        throw new UnauthorizedError('JWT missing required valid subject (sub) claim.');
      }

      return {
        userId: payload.sub.trim(),
        email: typeof payload.email === 'string' ? payload.email : undefined,
        claims: payload,
      };
    } catch (err: unknown) {
      if (err instanceof UnauthorizedError) throw err;
      if (err instanceof jose.errors.JWTExpired) {
        throw new UnauthorizedError('Authentication token has expired.');
      }
      if (err instanceof jose.errors.JWTClaimValidationFailed) {
        throw new UnauthorizedError(`Invalid token claims (claim: ${err.claim}): ${err.message}`);
      }
      throw new UnauthorizedError('Invalid token signature or claims.');
    }
  }

  // Standard production/dev path: verifies our own MCP Bearer token
  const result = await verifyMcpAccessToken(token);
  return {
    userId: result.installationId,
    email: typeof result.claims.email === 'string' ? result.claims.email : undefined,
    claims: result.claims,
  };
}
