import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { verifyJwt, clearJwksCache, getKeyResolver } from '../src/auth/jwt-verifier.js';
import { runWithUserContext, createUserContext, getCurrentUser } from '../src/auth/session.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { GmailClientService } from '../src/gmail/client.js';
import {
  sanitizeErrorMessage,
  UnauthorizedError,
  GmailNotConnectedError,
} from '../src/utils/errors.js';
import { redactSensitiveData, logger } from '../src/utils/logger.js';
import { sendToolSchema } from '../src/tools/send.js';
import { searchToolSchema } from '../src/tools/search.js';
import { listMessagesToolSchema, getMessageToolSchema } from '../src/tools/messages.js';
import { getThreadToolSchema } from '../src/tools/threads.js';
import {
  initTestJwks,
  resetTestJwks,
  createTestJwt,
  createForgedJwt,
  createRotatedKeyJwt,
} from './helpers/jwt-test-helper.js';
import { validateOAuthState } from '../src/auth/state.js';

describe('Phase 4 — Authentication Hardening Tests', () => {
  let server: Server;
  let protectedServer: Server;
  const PORT = 3981;
  const PROTECTED_PORT = 3982;
  const BASE_URL = `http://localhost:${PORT}`;
  const PROTECTED_BASE_URL = `http://localhost:${PROTECTED_PORT}`;
  const MCP_URL = `${BASE_URL}/mcp`;
  const PROTECTED_MCP_URL = `${PROTECTED_BASE_URL}/mcp`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = String(PORT);
    process.env.SUPABASE_URL = 'https://svqtutugnahwivpywysq.supabase.co';
    process.env.SUPABASE_JWKS_URL =
      'https://svqtutugnahwivpywysq.supabase.co/auth/v1/.well-known/jwks.json';

    await initTestJwks();

    // Standard app (test default)
    const app = createApp({ protectMcp: false });
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, () => resolve());
    });

    // Explicitly protected app (production behavior)
    const protectedApp = createApp({ protectMcp: true });
    await new Promise<void>((resolve) => {
      protectedServer = protectedApp.listen(PROTECTED_PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      protectedServer.close(() => resolve());
    });
    resetTestJwks();
  });

  beforeEach(() => {
    const store = getTokenStore() as MemoryTokenStore;
    if (store.clear) {
      store.clear();
    }
  });

  // 1. Valid JWT accepted
  it('1. Valid JWT is accepted and successfully verified', async () => {
    const token = await createTestJwt({
      sub: 'valid-user-001',
      email: 'valid-user@example.com',
    });

    const verified = await verifyJwt(token);
    expect(verified).toBeDefined();
    expect(verified.userId).toBe('valid-user-001');
    expect(verified.email).toBe('valid-user@example.com');
  });

  // 2. Valid JWT resolves correct `sub`
  it('2. Valid JWT resolves correct subject (`sub`) as user identity', async () => {
    const customSub = 'supabase-uuid-9988-7766';
    const token = await createTestJwt({
      sub: customSub,
      email: 'tester@supabase.co',
    });

    const verified = await verifyJwt(token);
    expect(verified.userId).toBe(customSub);
    expect(verified.claims.sub).toBe(customSub);
  });

  // 3. Invalid signature rejected
  it('3. Invalid signature is rejected with UnauthorizedError', async () => {
    const forgedToken = await createForgedJwt({
      sub: 'attacker-sub',
      email: 'attacker@evil.com',
    });

    await expect(verifyJwt(forgedToken)).rejects.toThrow(UnauthorizedError);
    await expect(verifyJwt(forgedToken)).rejects.toThrow(/Invalid token signature/);
  });

  // 4. Expired JWT rejected
  it('4. Expired JWT is rejected with UnauthorizedError', async () => {
    // Generate token expired 10 minutes ago
    const pastTimestamp = Math.floor(Date.now() / 1000) - 600;
    const expiredToken = await createTestJwt({
      sub: 'expired-user',
      expiresIn: pastTimestamp,
    });

    await expect(verifyJwt(expiredToken)).rejects.toThrow(UnauthorizedError);
    await expect(verifyJwt(expiredToken)).rejects.toThrow(/expired/i);
  });

  // 5. Invalid issuer rejected
  it('5. Invalid issuer is rejected when issuer claim does not match', async () => {
    const wrongIssuerToken = await createTestJwt({
      sub: 'user-wrong-iss',
      issuer: 'https://malicious-issuer.com/auth/v1',
    });

    await expect(
      verifyJwt(wrongIssuerToken, {
        issuer: 'https://svqtutugnahwivpywysq.supabase.co/auth/v1',
      })
    ).rejects.toThrow(/claim: iss/);
  });

  // 6. Invalid audience rejected
  it('6. Invalid audience is rejected when audience claim does not match', async () => {
    const wrongAudToken = await createTestJwt({
      sub: 'user-wrong-aud',
      audience: 'untrusted-audience',
    });

    await expect(
      verifyJwt(wrongAudToken, {
        audience: 'authenticated',
      })
    ).rejects.toThrow(/claim: aud/);
  });

  // 7. Missing `sub` rejected
  it('7. Missing or empty subject (`sub`) is rejected', async () => {
    const emptySubToken = await createTestJwt({
      sub: '   ',
    });

    await expect(verifyJwt(emptySubToken)).rejects.toThrow(
      /missing required valid subject \(sub\) claim/i
    );
  });

  // 8. Malformed JWT rejected
  it('8. Malformed JWT structure is rejected with UnauthorizedError', async () => {
    await expect(verifyJwt('not-a-token')).rejects.toThrow(UnauthorizedError);
    await expect(verifyJwt('header.payload')).rejects.toThrow(UnauthorizedError);
    await expect(verifyJwt('header.payload.sig.extra')).rejects.toThrow(UnauthorizedError);
    await expect(verifyJwt('')).rejects.toThrow(UnauthorizedError);
  });

  // 9. Missing Authorization header rejected
  it('9. Missing Authorization header is rejected with HTTP 401 on protected endpoints', async () => {
    // Endpoint /auth/login requires auth
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'GET',
      redirect: 'manual',
    });

    expect(loginRes.status).toBe(401);
    const body = await loginRes.json();
    expect(body.error).toBe('Unauthorized');
    expect(loginRes.headers.get('www-authenticate')).toContain('Bearer');
  });

  // 10. Malformed Bearer header rejected
  it('10. Malformed Bearer header is rejected with HTTP 401', async () => {
    // Empty Bearer token
    const emptyBearerRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(emptyBearerRes.status).toBe(401);
    const bodyEmpty = await emptyBearerRes.json();
    expect(bodyEmpty.error).toBe('Unauthorized');
    expect(bodyEmpty.message).toContain('Missing or empty Bearer token');

    // Invalid Bearer token
    const invalidBearerRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.token.payload',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });

    expect(invalidBearerRes.status).toBe(401);
    const bodyInvalid = await invalidBearerRes.json();
    expect(bodyInvalid.error).toBe('Unauthorized');
  });

  // 11. Query `?userId=victim` ignored/rejected
  it('11. Query parameter ?userId=victim cannot spoof or override authenticated user identity', async () => {
    const realUserToken = await createTestJwt({ sub: 'real-user-11' });

    const res = await fetch(`${MCP_URL}?userId=victim-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${realUserToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'gmail_mcp_status', arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const result = JSON.parse(json.result.content[0].text);

    expect(result.userId).toBe('real-user-11');
    expect(result.userId).not.toBe('victim-user');
  });

  // 12. X-User-ID spoofing ignored/rejected
  it('12. X-User-ID header cannot spoof or override authenticated user identity', async () => {
    const realUserToken = await createTestJwt({ sub: 'real-user-12' });

    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${realUserToken}`,
        'X-User-ID': 'impersonated-victim',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'gmail_mcp_status', arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const result = JSON.parse(json.result.content[0].text);

    expect(result.userId).toBe('real-user-12');
    expect(result.userId).not.toBe('impersonated-victim');
  });

  // 13. Tool argument user ID spoofing ignored/rejected
  it('13. All Gmail tool schemas strip and reject caller-supplied user_id, userId, or accountId', () => {
    const sendWithSpoof = {
      to: 'friend@example.com',
      subject: 'Hello',
      body: 'Content',
      user_id: 'victim-id',
      userId: 'victim-id',
      accountId: 'victim-account',
    };
    const parsedSend = sendToolSchema.parse(sendWithSpoof);
    expect((parsedSend as any).user_id).toBeUndefined();
    expect((parsedSend as any).userId).toBeUndefined();
    expect((parsedSend as any).accountId).toBeUndefined();

    const searchWithSpoof = { query: 'label:inbox', user_id: 'victim-id' };
    const parsedSearch = searchToolSchema.parse(searchWithSpoof);
    expect((parsedSearch as any).user_id).toBeUndefined();

    const listWithSpoof = { user_id: 'victim-id' };
    const parsedList = listMessagesToolSchema.parse(listWithSpoof);
    expect((parsedList as any).user_id).toBeUndefined();

    const msgWithSpoof = { messageId: 'm123', user_id: 'victim-id' };
    const parsedMsg = getMessageToolSchema.parse(msgWithSpoof);
    expect((parsedMsg as any).user_id).toBeUndefined();

    const threadWithSpoof = { threadId: 't456', user_id: 'victim-id' };
    const parsedThread = getThreadToolSchema.parse(threadWithSpoof);
    expect((parsedThread as any).user_id).toBeUndefined();
  });

  // 14. User A cannot access User B credentials
  it('14. User A execution context can NEVER access User B credentials in TokenStore', async () => {
    const tokenStore = getTokenStore();
    // Save credentials strictly for User B
    await tokenStore.saveUserCredentials('user-B', {
      access_token: 'secret-access-token-B',
      refresh_token: 'secret-refresh-token-B',
      emailAddress: 'userB@gmail.com',
    });

    const userAContext = createUserContext('user-A');

    await runWithUserContext(userAContext, async () => {
      expect(await GmailClientService.isConnected()).toBe(false);
      await expect(GmailClientService.getClient()).rejects.toThrow(GmailNotConnectedError);
    });
  });

  // 15. User B cannot access User A credentials
  it('15. User B execution context can NEVER access User A credentials in TokenStore', async () => {
    const tokenStore = getTokenStore();
    // Save credentials strictly for User A
    await tokenStore.saveUserCredentials('user-A', {
      access_token: 'secret-access-token-A',
      refresh_token: 'secret-refresh-token-A',
      emailAddress: 'userA@gmail.com',
    });

    const userBContext = createUserContext('user-B');

    await runWithUserContext(userBContext, async () => {
      expect(await GmailClientService.isConnected()).toBe(false);
      await expect(GmailClientService.getClient()).rejects.toThrow(GmailNotConnectedError);
    });
  });

  // 16. JWKS key caching works
  it('16. JWKS key caching works and avoids repeated key resolution', () => {
    const resolver1 = getKeyResolver();
    const resolver2 = getKeyResolver();
    expect(resolver1).toBe(resolver2);
  });

  // 17. JWKS key rotation is handled
  it('17. JWKS key rotation is handled seamlessly when signed with rotated key', async () => {
    const rotatedToken = await createRotatedKeyJwt({
      sub: 'rotated-key-user',
      email: 'rotated@example.com',
    });

    const verified = await verifyJwt(rotatedToken);
    expect(verified).toBeDefined();
    expect(verified.userId).toBe('rotated-key-user');
    expect(verified.claims.sub).toBe('rotated-key-user');
  });

  // 18. Protected `/mcp` rejects unauthenticated requests
  it('18. Protected /mcp rejects unauthenticated requests with HTTP 401', async () => {
    const res = await fetch(PROTECTED_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 18,
        method: 'tools/call',
        params: { name: 'gmail_mcp_status', arguments: {} },
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toContain('Missing Authorization header');
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  // 18b. Protected `/mcp` rejects non-Bearer schemes, bare Bearer, and malformed Bearer tokens with HTTP 401
  it('18b. Protected /mcp strictly enforces Bearer scheme and rejects non-Bearer schemes with HTTP 401', async () => {
    const testCases = [
      { scheme: 'Basic test-token', expectedMsg: 'Bearer token required' },
      { scheme: 'Token test-token', expectedMsg: 'Bearer token required' },
      { scheme: 'Digest test-token', expectedMsg: 'Bearer token required' },
      { scheme: 'Custom test-token', expectedMsg: 'Bearer token required' },
    ];

    for (const { scheme, expectedMsg } of testCases) {
      const res = await fetch(PROTECTED_MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: scheme,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 181,
          method: 'tools/call',
          params: { name: 'gmail_mcp_status', arguments: {} },
        }),
      });

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toBe(expectedMsg);
      // Ensure token contents are never leaked in the error response
      expect(JSON.stringify(body)).not.toContain('test-token');
    }

    // Bare Bearer header with no token
    const bareBearerRes = await fetch(PROTECTED_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 182,
        method: 'tools/call',
        params: { name: 'gmail_mcp_status', arguments: {} },
      }),
    });

    expect(bareBearerRes.status).toBe(401);
    expect(bareBearerRes.headers.get('www-authenticate')).toContain('Bearer');
    const bareBody = await bareBearerRes.json();
    expect(bareBody.error).toBe('Unauthorized');
    expect(bareBody.message).toContain('Missing or empty Bearer token');

    // Bearer header with malformed JWT
    const malformedBearerRes = await fetch(PROTECTED_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer malformed.jwt.token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 183,
        method: 'tools/call',
        params: { name: 'gmail_mcp_status', arguments: {} },
      }),
    });

    expect(malformedBearerRes.status).toBe(401);
    expect(malformedBearerRes.headers.get('www-authenticate')).toContain('Bearer');
    const malformedBody = await malformedBearerRes.json();
    expect(malformedBody.error).toBe('Unauthorized');
    expect(JSON.stringify(malformedBody)).not.toContain('malformed.jwt.token');
  });

  // 19. Authenticated `/mcp` reaches MCP execution
  it('19. Authenticated /mcp with valid JWT reaches MCP execution and returns HTTP 200', async () => {
    const token = await createTestJwt({ sub: 'protected-user-19' });

    const res = await fetch(PROTECTED_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: { name: 'gmail_mcp_status', arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result).toBeDefined();
    const statusData = JSON.parse(json.result.content[0].text);
    expect(statusData.userId).toBe('protected-user-19');
    expect(statusData.server).toBe('Gmail MCP');
  });

  // 20. Authentication secrets are never logged
  it('20. Authentication secrets and tokens are redacted and never leaked to logs', () => {
    const secretKey = 'sb_secret_very_sensitive_key_99999';
    const rawJwt =
      'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLogSignature';
    const authHeader = `Bearer ${rawJwt}`;

    const logEntry = `User request with auth: ${authHeader}, secret: ${secretKey}`;
    const redacted = redactSensitiveData(logEntry);

    expect(redacted).not.toContain(rawJwt);
    expect(redacted).not.toContain(secretKey);
    expect(redacted).toContain('[REDACTED]');
  });

  describe('Phase 5B — Safe OAuth Browser Initiation Flow (/login and /auth/login)', () => {
    it('A. GET /auth/login without Authorization header returns HTTP 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'GET',
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
      expect(res.headers.get('www-authenticate')).toContain('Bearer');
    });

    it('B. GET /auth/login with invalid JWT returns HTTP 401 Unauthorized', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer invalid.jwt.token',
          Accept: 'application/json',
        },
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('C. GET /auth/login with valid JWT and Accept: application/json returns HTTP 200 JSON with OAuth URL', async () => {
      const testUserId = 'test-supabase-user-5b';
      const token = await createTestJwt({ sub: testUserId, email: 'test5b@example.com' });

      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        redirect: 'manual',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const data = await res.json();
      expect(data.url).toBeDefined();
      expect(data.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });

    it('D. Returned OAuth URL contains a cryptographically signed state bound strictly to verified user ID', async () => {
      const testUserId = 'user-bound-identity-5b';
      const token = await createTestJwt({ sub: testUserId, email: 'bound@example.com' });

      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      const parsedUrl = new URL(data.url);
      const stateParam = parsedUrl.searchParams.get('state');
      expect(stateParam).toBeDefined();

      // Cryptographically validate state and bound identity
      const validatedState = validateOAuthState(stateParam!);
      expect(validatedState.userId).toBe(testUserId);
      expect(validatedState.timestamp).toBeGreaterThan(0);
      expect(validatedState.nonce).toBeDefined();
    });

    it('E. /login page is publicly accessible without authentication', async () => {
      const res = await fetch(`${BASE_URL}/login`, {
        method: 'GET',
        redirect: 'manual',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Connect Gmail Account');
      expect(html).toContain('login-form');
      expect(html).toContain('type="email"');
      expect(html).toContain('type="password"');
    });

    it('F. Does NOT expose Supabase JWT in page URL, query strings, or redirect responses', async () => {
      const testUserId = 'secret-jwt-user';
      const token = await createTestJwt({ sub: testUserId });

      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      const bodyText = await res.text();
      // Ensure the returned JSON body contains no JWT
      expect(bodyText).not.toContain(token);

      const parsed = JSON.parse(bodyText);
      const parsedUrl = new URL(parsed.url);
      // Ensure Google OAuth URL contains no JWT
      expect(parsedUrl.search).not.toContain(token);
      expect(parsedUrl.searchParams.get('token')).toBeNull();
    });

    it('G. Does NOT expose JWT in server logs (redacted in log entries)', () => {
      const rawJwt = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLXJlZGFjdCJ9.signature';
      const logString = `GET /auth/login Authorization: Bearer ${rawJwt}`;
      const redacted = redactSensitiveData(logString);
      expect(redacted).not.toContain(rawJwt);
      expect(redacted).toContain('[REDACTED]');
    });
  });
});
