import * as jose from 'jose';
import { setTestKeyResolver } from '../../src/auth/jwt-verifier.js';

export interface TestJwtOptions {
  sub: string;
  email?: string;
  issuer?: string;
  audience?: string | string[];
  expiresIn?: string | number; // e.g. '1h' or Unix timestamp in seconds
  notBefore?: string | number;
  customClaims?: Record<string, unknown>;
  kid?: string;
  alg?: string;
}

let testPrivateKey: jose.KeyLike | null = null;
let testPublicKey: jose.KeyLike | null = null;
let testPublicJwk: jose.JWK | null = null;

// Secondary key pair for key rotation & signature mismatch testing
let secondaryPrivateKey: jose.KeyLike | null = null;
let secondaryPublicJwk: jose.JWK | null = null;

export async function initTestJwks(): Promise<void> {
  if (!testPrivateKey) {
    const keyPair = await jose.generateKeyPair('ES256', { extractable: true });
    testPrivateKey = keyPair.privateKey;
    testPublicKey = keyPair.publicKey;

    const jwk = await jose.exportJWK(testPublicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'ES256';
    jwk.use = 'sig';
    testPublicJwk = jwk;

    // Generate secondary key pair
    const secPair = await jose.generateKeyPair('ES256', { extractable: true });
    secondaryPrivateKey = secPair.privateKey;
    const secJwk = await jose.exportJWK(secPair.publicKey);
    secJwk.kid = 'test-key-2';
    secJwk.alg = 'ES256';
    secJwk.use = 'sig';
    secondaryPublicJwk = secJwk;
  }

  // Register primary test JWKS with jwt-verifier
  const jwkSet = jose.createLocalJWKSet({
    keys: [testPublicJwk!, secondaryPublicJwk!],
  });
  setTestKeyResolver(jwkSet);
}

export function resetTestJwks(): void {
  setTestKeyResolver(null);
}

/**
 * Creates a cryptographically signed test JWT
 */
export async function createTestJwt(options: TestJwtOptions): Promise<string> {
  if (!testPrivateKey) {
    await initTestJwks();
  }

  const {
    sub,
    email,
    issuer,
    audience = 'authenticated',
    expiresIn = '1h',
    notBefore,
    customClaims = {},
    kid = 'test-key-1',
    alg = 'ES256',
  } = options;

  const payload: Record<string, unknown> = {
    ...customClaims,
  };
  if (email) {
    payload.email = email;
  }

  let signer = new jose.SignJWT(payload).setProtectedHeader({ alg, kid }).setSubject(sub);

  if (issuer) {
    signer = signer.setIssuer(issuer);
  }
  if (audience) {
    signer = signer.setAudience(audience);
  }
  if (notBefore !== undefined) {
    signer = signer.setNotBefore(notBefore);
  }
  if (expiresIn !== undefined) {
    signer = signer.setExpirationTime(expiresIn);
  }

  return await signer.sign(testPrivateKey!);
}

/**
 * Creates a JWT signed with an untrusted / foreign key (to test invalid signature)
 */
export async function createForgedJwt(options: TestJwtOptions): Promise<string> {
  const untrustedPair = await jose.generateKeyPair('ES256');
  const {
    sub,
    email,
    issuer,
    audience = 'authenticated',
    expiresIn = '1h',
    kid = 'test-key-1',
  } = options;

  const payload: Record<string, unknown> = {};
  if (email) payload.email = email;

  let signer = new jose.SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid }).setSubject(sub);

  if (issuer) signer = signer.setIssuer(issuer);
  if (audience) signer = signer.setAudience(audience);
  if (expiresIn) signer = signer.setExpirationTime(expiresIn);

  return await signer.sign(untrustedPair.privateKey);
}

/**
 * Signs with the secondary valid key to test key rotation
 */
export async function createRotatedKeyJwt(options: TestJwtOptions): Promise<string> {
  if (!secondaryPrivateKey) {
    await initTestJwks();
  }
  const { sub, email, issuer, audience = 'authenticated', expiresIn = '1h' } = options;

  const payload: Record<string, unknown> = {};
  if (email) payload.email = email;

  let signer = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-2' })
    .setSubject(sub);

  if (issuer) signer = signer.setIssuer(issuer);
  if (audience) signer = signer.setAudience(audience);
  if (expiresIn) signer = signer.setExpirationTime(expiresIn);

  return await signer.sign(secondaryPrivateKey!);
}
