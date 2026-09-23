import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { clearOAuthConsumedNonces } from '../src/auth/oauth-server.js';
import { verifyMcpAccessToken } from '../src/auth/mcp-token.js';

describe('Phase 7 — ChatGPT OAuth Compatibility Tests', () => {
  let server: Server;
  const PORT = 3985;
  const BASE_URL = `http://localhost:${PORT}`;
  const MCP_URL = `${BASE_URL}/mcp`;

  // Helper to generate S256 PKCE challenge & verifier
  function generatePkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
    return { verifier, challenge };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = String(PORT);

    const app = createApp({ protectMcp: true });
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    clearOAuthConsumedNonces();
    const store = getTokenStore() as MemoryTokenStore;
    if (store.clear) {
      store.clear();
    }
  });

  // =========================================================================
  // 1. Discovery Metadata Tests (RFC 9728 & RFC 8414)
  // =========================================================================
  describe('A. OAuth Discovery Endpoints', () => {
    it('1. GET /.well-known/oauth-protected-resource returns HTTP 200 with RFC 9728 metadata', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');

      const data = await res.json();
      expect(data.resource).toBe(MCP_URL);
      expect(data.authorization_servers).toContain(BASE_URL);
      expect(data.bearer_methods_supported).toContain('header');
      expect(data.scopes_supported).toContain('gmail');
    });

    it('2. GET /.well-known/oauth-authorization-server returns HTTP 200 with RFC 8414 metadata', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();
      expect(data.issuer).toBe(BASE_URL);
      expect(data.authorization_endpoint).toBe(`${BASE_URL}/oauth/authorize`);
      expect(data.token_endpoint).toBe(`${BASE_URL}/oauth/token`);
      expect(data.response_types_supported).toContain('code');
      expect(data.grant_types_supported).toContain('authorization_code');
      expect(data.code_challenge_methods_supported).toContain('S256');
    });

    it('3. GET /.well-known/oauth-protected-resource/mcp provides identical RFC 9728 metadata', async () => {
      const res = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource/mcp`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.resource).toBe(MCP_URL);
    });

    it('4. Unauthenticated request to /mcp returns HTTP 401 with WWW-Authenticate header', async () => {
      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      });

      expect(res.status).toBe(401);
      const authHeader = res.headers.get('www-authenticate') || '';
      expect(authHeader).toContain('Bearer');
      expect(authHeader).toContain('resource_metadata=');
      expect(authHeader).toContain('.well-known/oauth-protected-resource');
    });
  });

  // =========================================================================
  // 2. Authorization Endpoint Tests (/oauth/authorize)
  // =========================================================================
  describe('B. OAuth Authorization Endpoint (/oauth/authorize)', () => {
    it('5. Rejects missing or invalid parameters on GET /oauth/authorize', async () => {
      // Missing client_id and redirect_uri
      const res1 = await fetch(`${BASE_URL}/oauth/authorize?response_type=code`);
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.error).toBe('invalid_request');

      // Invalid response_type (e.g. token)
      const res2 = await fetch(
        `${BASE_URL}/oauth/authorize?response_type=token&client_id=chatgpt&redirect_uri=https://chatgpt.com/callback&code_challenge=test`
      );
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.error).toBe('unsupported_response_type');

      // Missing PKCE code_challenge
      const res3 = await fetch(
        `${BASE_URL}/oauth/authorize?response_type=code&client_id=chatgpt&redirect_uri=https://chatgpt.com/callback`
      );
      expect(res3.status).toBe(400);
      const data3 = await res3.json();
      expect(data3.error).toBe('invalid_request');
      expect(data3.error_description).toContain('code_challenge');
    });

    it('6. Renders HTML consent page with valid parameters on GET /oauth/authorize without asking for password', async () => {
      const { challenge } = generatePkce();
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: 'chatgpt-client',
        redirect_uri: 'https://chatgpt.com/aip/callback',
        scope: 'gmail offline_access',
        state: 'csrf-state-abc123xyz',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });

      const res = await fetch(`${BASE_URL}/oauth/authorize?${params.toString()}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('Authorize ChatGPT');
      expect(html).toContain('chatgpt-client');
      expect(html).toContain('csrf-state-abc123xyz');
      expect(html).toContain('action="/oauth/authorize"');
      // No Supabase password form
      expect(html).not.toContain('type="password"');
    });

    it('7. POST /oauth/authorize authorizes ChatGPT installation and redirects with authorization code', async () => {
      const { challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const state = 'state-nonce-456';

      const body = new URLSearchParams({
        client_id: 'chatgpt-client',
        redirect_uri: redirectUri,
        scope: 'gmail offline_access',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });

      const res = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(location).toBeDefined();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin + redirectUrl.pathname).toBe(redirectUri);
      expect(redirectUrl.searchParams.get('state')).toBe(state);

      const code = redirectUrl.searchParams.get('code');
      expect(code).toBeDefined();
      expect(typeof code).toBe('string');
      expect(code!.length).toBeGreaterThan(20);
    });

    it('8. POST /oauth/authorize with missing required parameters returns HTTP 400 error', async () => {
      const body = new URLSearchParams({
        client_id: '',
        redirect_uri: 'https://chatgpt.com/aip/callback',
      });

      const res = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_request');
    });

    it('8b. POST /oauth/authorize via AJAX returns JSON with redirectUrl on success', async () => {
      const { challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';

      const successRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: 'chatgpt-client',
          redirect_uri: redirectUri,
          scope: 'gmail',
          state: 'ajax-state-1',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
      });

      expect(successRes.status).toBe(200);
      const successData = await successRes.json();
      expect(successData.redirectUrl).toBeDefined();
      expect(successData.redirectUrl).toContain(redirectUri);
      expect(successData.redirectUrl).toContain('code=');
      expect(successData.redirectUrl).toContain('state=ajax-state-1');
    });
  });

  // =========================================================================
  // 3. Token Endpoint & PKCE Security Tests (/oauth/token)
  // =========================================================================
  describe('C. OAuth Token Endpoint & PKCE Security (/oauth/token)', () => {
    it('9. Exchanges authorization code with valid PKCE verifier for own MCP access token and refresh token', async () => {
      const { verifier, challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const clientId = 'chatgpt-client';

      // 1. Authorize
      const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'gmail offline_access',
          state: 'state-123',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });

      const location = new URL(authRes.headers.get('location')!);
      const code = location.searchParams.get('code')!;

      // 2. Exchange code
      const tokenRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.headers.get('cache-control')).toBe('no-store');
      expect(tokenRes.headers.get('access-control-allow-origin')).toBe('*');

      const tokenData = await tokenRes.json();
      expect(tokenData.token_type).toBe('Bearer');
      expect(tokenData.expires_in).toBe(3600);
      expect(typeof tokenData.access_token).toBe('string');
      expect(typeof tokenData.refresh_token).toBe('string');
      expect(tokenData.scope).toContain('gmail');

      // Verify token contains installation ID (gm_...)
      const verified = await verifyMcpAccessToken(tokenData.access_token);
      expect(verified.installationId).toMatch(/^gm_[0-9a-f]{32}$/);
    });

    it('10. Replay protection: Authorization code CANNOT be reused', async () => {
      const { verifier, challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const clientId = 'chatgpt-client';

      const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'gmail',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });

      const location = new URL(authRes.headers.get('location')!);
      const code = location.searchParams.get('code')!;

      // First exchange: succeeds
      const firstRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });
      expect(firstRes.status).toBe(200);

      // Second exchange with identical code: REJECTED with 400 invalid_grant
      const secondRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });

      expect(secondRes.status).toBe(400);
      const secondData = await secondRes.json();
      expect(secondData.error).toBe('invalid_grant');
      expect(secondData.error_description).toContain('consumed');
    });

    it('11. Rejects code exchange when PKCE code_verifier does not match challenge', async () => {
      const { challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const clientId = 'chatgpt-client';

      const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'gmail',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });

      const location = new URL(authRes.headers.get('location')!);
      const code = location.searchParams.get('code')!;

      // Attempt exchange with WRONG verifier
      const tokenRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: 'completely-wrong-verifier-1234567890abcdef',
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });

      expect(tokenRes.status).toBe(400);
      const tokenData = await tokenRes.json();
      expect(tokenData.error).toBe('invalid_grant');
      expect(tokenData.error_description).toContain('PKCE');
    });

    it('12. Rejects code exchange when client_id or redirect_uri mismatch', async () => {
      const { verifier, challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const clientId = 'chatgpt-client';

      const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'gmail',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });

      const location = new URL(authRes.headers.get('location')!);
      const code = location.searchParams.get('code')!;

      // Wrong redirect_uri
      const wrongRedirectRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: 'https://attacker.com/evil-callback',
        }),
      });
      expect(wrongRedirectRes.status).toBe(400);
      const wrongRedirData = await wrongRedirectRes.json();
      expect(wrongRedirData.error).toBe('invalid_grant');

      // Wrong client_id
      const wrongClientRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: 'impersonating-client',
          redirect_uri: redirectUri,
        }),
      });
      expect(wrongClientRes.status).toBe(400);
      const wrongClientData = await wrongClientRes.json();
      expect(wrongClientData.error).toBe('invalid_grant');
    });

    it('13. Exchanges refresh_token for a fresh access_token via grant_type=refresh_token', async () => {
      const { verifier, challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const clientId = 'chatgpt-client';

      // 1. Initial authorization & code exchange
      const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'gmail offline_access',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });

      const location = new URL(authRes.headers.get('location')!);
      const code = location.searchParams.get('code')!;

      const initialTokenRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });
      const initialTokens = await initialTokenRes.json();
      expect(initialTokens.refresh_token).toBeDefined();

      // 2. Perform refresh token exchange
      const refreshRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: initialTokens.refresh_token,
        }),
      });

      expect(refreshRes.status).toBe(200);
      const refreshData = await refreshRes.json();
      expect(refreshData.token_type).toBe('Bearer');
      expect(refreshData.expires_in).toBe(3600);
      expect(typeof refreshData.access_token).toBe('string');
      expect(typeof refreshData.refresh_token).toBe('string');
    });
  });

  // =========================================================================
  // 4. End-to-End MCP & Multi-User Isolation Tests
  // =========================================================================
  describe('D. End-to-End MCP & Multi-User Isolation', () => {
    it('14. ChatGPT access token connects to /mcp and executes tools with verified installation identity', async () => {
      const { verifier, challenge } = generatePkce();
      const redirectUri = 'https://chatgpt.com/aip/callback';
      const clientId = 'chatgpt-client';

      // 1. Authorize
      const authRes = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: 'gmail',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });

      const location = new URL(authRes.headers.get('location')!);
      const code = location.searchParams.get('code')!;

      const tokenRes = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: redirectUri,
        }),
      });
      const tokenData = await tokenRes.json();
      const mcpAccessToken = tokenData.access_token;

      // 2. ChatGPT calls /mcp initialize with Bearer token
      const initRes = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${mcpAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ChatGPT-Connector', version: '1.0' },
          },
        }),
      });

      expect(initRes.status).toBe(200);
      const initData = await initRes.json();
      expect(initData.result.serverInfo.name).toBe('Gmail MCP');

      // 3. ChatGPT calls tools/call (gmail_mcp_status)
      const toolRes = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${mcpAccessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 102,
          method: 'tools/call',
          params: {
            name: 'gmail_mcp_status',
            arguments: {},
          },
        }),
      });

      expect(toolRes.status).toBe(200);
      const toolData = await toolRes.json();
      const statusResult = JSON.parse(toolData.result.content[0].text);
      expect(statusResult.userId).toMatch(/^gm_[0-9a-f]{32}$/);
      expect(statusResult.server).toBe('Gmail MCP');
    });

    it('15. Strict Multi-User Isolation: Installation A token executes as Installation A, Installation B executes as B', async () => {
      // 1. Authorize Installation A
      const pkceA = generatePkce();
      const authResA = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'chatgpt',
          redirect_uri: 'https://chatgpt.com/callback',
          scope: 'gmail',
          code_challenge: pkceA.challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });
      const codeA = new URL(authResA.headers.get('location')!).searchParams.get('code')!;

      const tokenResA = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: codeA,
          code_verifier: pkceA.verifier,
          client_id: 'chatgpt',
          redirect_uri: 'https://chatgpt.com/callback',
        }),
      });
      const { access_token: tokenA } = await tokenResA.json();
      const verifiedA = await verifyMcpAccessToken(tokenA);

      // 2. Authorize Installation B
      const pkceB = generatePkce();
      const authResB = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'chatgpt',
          redirect_uri: 'https://chatgpt.com/callback',
          scope: 'gmail',
          code_challenge: pkceB.challenge,
          code_challenge_method: 'S256',
        }).toString(),
        redirect: 'manual',
      });
      const codeB = new URL(authResB.headers.get('location')!).searchParams.get('code')!;

      const tokenResB = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: codeB,
          code_verifier: pkceB.verifier,
          client_id: 'chatgpt',
          redirect_uri: 'https://chatgpt.com/callback',
        }),
      });
      const { access_token: tokenB } = await tokenResB.json();
      const verifiedB = await verifyMcpAccessToken(tokenB);

      // Save credentials for Installation A and B
      const tokenStore = getTokenStore();
      await tokenStore.saveUserCredentials(verifiedA.installationId, {
        access_token: 'google-token-A',
        emailAddress: 'designer@kairali.com',
      });
      await tokenStore.saveUserCredentials(verifiedB.installationId, {
        access_token: 'google-token-B',
        emailAddress: 'c.graphics00@gmail.com',
      });

      // Execute status tool with Token A
      const resA = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 201,
          method: 'tools/call',
          params: { name: 'gmail_mcp_status', arguments: {} },
        }),
      });
      const dataA = JSON.parse((await resA.json()).result.content[0].text);
      expect(dataA.userId).toBe(verifiedA.installationId);
      expect(dataA.emailAddress).toBe('designer@kairali.com');

      // Execute status tool with Token B
      const resB = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${tokenB}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 202,
          method: 'tools/call',
          params: { name: 'gmail_mcp_status', arguments: {} },
        }),
      });
      const dataB = JSON.parse((await resB.json()).result.content[0].text);
      expect(dataB.userId).toBe(verifiedB.installationId);
      expect(dataB.emailAddress).toBe('c.graphics00@gmail.com');

      // Distinct identities
      expect(verifiedA.installationId).not.toBe(verifiedB.installationId);
    });

    it('16. Rejects forged or tampered ChatGPT access tokens with HTTP 401', async () => {
      const forgedToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJnbV9mYWtlMTIzNDU2Nzg5MDEyMzQ1Njc4OTAifQ.invalidSignature';

      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${forgedToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 301,
          method: 'tools/call',
          params: { name: 'gmail_mcp_status', arguments: {} },
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });
  });
});
