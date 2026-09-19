import * as jose from 'jose';
import { getEnv } from '../config/env.js';
import { UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

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

// Cached remote JWKS resolver instance
let remoteJwkSet: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let cachedJwksUrl: string | null = null;

// Test hook for custom key resolver (e.g. in-memory JWKS or test key pair)
let testKeyResolver: JwkKeyResolver | null = null;

/**
 * Sets a custom key resolver for unit tests (e.g. mocked JWKS or test key pair)
 */
export function setTestKeyResolver(resolver: JwkKeyResolver | null): void {
  testKeyResolver = resolver;
}

/**
 * Clears the remote JWKS cache
 */
export function clearJwksCache(): void {
  remoteJwkSet = null;
  cachedJwksUrl = null;
  testKeyResolver = null;
}

/**
 * Obtains the active key resolver.
 * In production/dev, uses jose.createRemoteJWKSet with appropriate caching and rotation support.
 */
export function getKeyResolver(): JwkKeyResolver {
  if (testKeyResolver) {
    return testKeyResolver;
  }

  const env = getEnv();
  const jwksUrl = env.SUPABASE_JWKS_URL;

  if (!jwksUrl) {
    throw new UnauthorizedError(
      'SUPABASE_JWKS_URL is not configured. Cryptographic token verification requires a valid JWKS endpoint.'
    );
  }

  if (!remoteJwkSet || cachedJwksUrl !== jwksUrl) {
    remoteJwkSet = jose.createRemoteJWKSet(new URL(jwksUrl), {
      // Cache JWKS keys; jose handles key rotation by refetching when an unknown `kid` is encountered
      cooldownDuration: 10 * 1000, // 10 seconds cooldown between background JWKS refetches
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes cache duration
    });
    cachedJwksUrl = jwksUrl;
  }

  return remoteJwkSet;
}

/**
 * Cryptographically verifies a Supabase / OIDC JWT and extracts the authenticated subject (`sub`).
 *
 * Validates:
 * - Signature against JWKS keys
 * - Expiration (`exp`)
 * - Not-before (`nbf`) if present
 * - Issuer (`iss`) if configured or matched to Supabase Auth
 * - Audience (`aud`) if configured or matched to Supabase Auth
 * - Subject (`sub`): must exist, be a non-empty string, and will form the authenticated user identity
 */
export async function verifyJwt(
  token: string,
  options?: JwtVerifyOptions
): Promise<VerifiedJwtUser> {
  if (!token || typeof token !== 'string') {
    throw new UnauthorizedError('Missing or empty authentication token.');
  }

  // Enforce standard JWT structure (header.payload.signature)
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Malformed JWT token structure.');
  }

  const keyResolver = getKeyResolver();
  const env = getEnv();

  // Determine expected issuer: caller override, or derived from SUPABASE_URL if available
  const expectedIssuer =
    options?.issuer ||
    (env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1` : undefined);

  // Supabase Auth JWTs standard audience is 'authenticated'
  const expectedAudience = options?.audience || 'authenticated';

  try {
    const verifyOptions: jose.JWTVerifyOptions = {
      algorithms: ['ES256', 'RS256', 'EdDSA', 'PS256'],
    };

    if (expectedIssuer) {
      verifyOptions.issuer = expectedIssuer;
    }
    if (expectedAudience) {
      verifyOptions.audience = expectedAudience;
    }

    const { payload } = await jose.jwtVerify(token, keyResolver, verifyOptions);

    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      throw new UnauthorizedError('JWT missing required valid subject (sub) claim.');
    }

    const userId = payload.sub.trim();
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    return {
      userId,
      email,
      claims: payload,
    };
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      throw err;
    }

    if (err instanceof jose.errors.JWTExpired) {
      logger.warn('JWT verification failed: token has expired');
      throw new UnauthorizedError('Authentication token has expired.');
    }

    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      logger.warn('JWT verification failed: signature verification failed');
      throw new UnauthorizedError('Invalid token signature.');
    }

    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      logger.warn(`JWT verification failed claim validation: ${err.claim}`);
      throw new UnauthorizedError(`Token validation failed for claim: ${err.claim}.`);
    }

    if (err instanceof jose.errors.JOSEError) {
      logger.warn('JWT verification failed with JOSE error');
      throw new UnauthorizedError('Authentication token is invalid.');
    }

    logger.warn('Unexpected error during JWT verification');
    throw new UnauthorizedError('Authentication failed.');
  }
}
