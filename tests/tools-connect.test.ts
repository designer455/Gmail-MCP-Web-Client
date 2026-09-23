import { describe, it, expect, beforeEach } from 'vitest';
import { handleConnectTool, connectToolSchema } from '../src/tools/connect.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';
import { verifyGoogleLinkToken, clearConsumedLinkTokens } from '../src/auth/link-token.js';
import { GMAIL_TOOLS } from '../src/server.js';
import { generateInstallationId } from '../src/auth/installation.js';

describe('MCP Tool: gmail_connect', () => {
  beforeEach(() => {
    clearConsumedLinkTokens();
    const globalStore = getTokenStore() as MemoryTokenStore;
    if (globalStore.clear) {
      globalStore.clear();
    }
  });

  // 1. Appears in tools list
  it('1. gmail_connect appears in GMAIL_TOOLS and tools/list schema', () => {
    const connectTool = GMAIL_TOOLS.find((t) => t.name === 'gmail_connect');
    expect(connectTool).toBeDefined();
    expect(connectTool?.name).toBe('gmail_connect');
    expect(connectTool?.description).toContain('Google OAuth');
    expect(connectTool?.inputSchema.additionalProperties).toBe(false);
  });

  // 2. Unlinked installation receives a valid one-time URL
  it('2. Unlinked installation receives connected=false and a valid one-time URL', async () => {
    const installationId = generateInstallationId();
    const user = createUserContext(installationId);

    await runWithUserContext(user, async () => {
      const result = await handleConnectTool();

      expect(result.connected).toBe(false);
      expect(result.message).toBe('Connect your Gmail account using the link below.');
      expect(result.url).toBeDefined();
      expect(result.url).toMatch(/^https:\/\/[^/]+\/auth\/google\/link\?token=/);

      // Verify token is bound to installationId
      const urlObj = new URL(result.url!);
      const token = urlObj.searchParams.get('token')!;
      const verified = verifyGoogleLinkToken(token);
      expect(verified.installationId).toBe(installationId);
    });
  });

  // 3. Different installations receive different links
  it('3. Different installations receive distinct links bound to their respective installationId', async () => {
    const installA = generateInstallationId();
    const installB = generateInstallationId();

    let linkA: string | undefined;
    let linkB: string | undefined;

    await runWithUserContext(createUserContext(installA), async () => {
      const resA = await handleConnectTool();
      linkA = resA.url;
    });

    await runWithUserContext(createUserContext(installB), async () => {
      const resB = await handleConnectTool();
      linkB = resB.url;
    });

    expect(linkA).toBeDefined();
    expect(linkB).toBeDefined();
    expect(linkA).not.toBe(linkB);

    const tokenA = new URL(linkA!).searchParams.get('token')!;
    const tokenB = new URL(linkB!).searchParams.get('token')!;

    expect(verifyGoogleLinkToken(tokenA).installationId).toBe(installA);
    expect(verifyGoogleLinkToken(tokenB).installationId).toBe(installB);
  });

  // 4. Connected installation receives connected=true
  it('4. Connected installation receives connected=true and no connection URL', async () => {
    const installationId = generateInstallationId();
    const tokenStore = getTokenStore();

    await tokenStore.saveUserCredentials(installationId, {
      access_token: 'valid-google-token',
      emailAddress: 'connected@example.com',
    });

    const user = createUserContext(installationId);

    await runWithUserContext(user, async () => {
      const result = await handleConnectTool();

      expect(result.connected).toBe(true);
      expect(result.message).toBe('Gmail account is already connected.');
      expect(result.url).toBeUndefined();
    });
  });

  // 5. Caller cannot supply installationId / userId
  it('5. Caller cannot supply another installationId or userId to spoof identity', () => {
    // connectToolSchema has additionalProperties: false / strict
    const spoofAttempts = [
      { installationId: 'gm_attacker' },
      { userId: 'gm_attacker' },
      { user_id: 'gm_attacker' },
      { accountId: 'gm_attacker' },
    ];

    for (const attempt of spoofAttempts) {
      expect(() => connectToolSchema.parse(attempt)).toThrow();
    }
  });

  // 6. Link replay remains blocked
  it('6. Link replay remains blocked: redeemed link token cannot be verified a second time', async () => {
    const installationId = generateInstallationId();
    const user = createUserContext(installationId);

    await runWithUserContext(user, async () => {
      const result = await handleConnectTool();
      const token = new URL(result.url!).searchParams.get('token')!;

      // First verification succeeds (redeems token)
      const firstCheck = verifyGoogleLinkToken(token);
      expect(firstCheck.installationId).toBe(installationId);

      // Second verification attempt is rejected as already consumed
      expect(() => verifyGoogleLinkToken(token)).toThrow(
        /already been used|already been consumed|invalid/i
      );
    });
  });

  // 7. No secrets or credentials are exposed
  it('7. No secrets, tokens, or encryption keys are leaked in tool response', async () => {
    const installationId = generateInstallationId();
    const user = createUserContext(installationId);

    await runWithUserContext(user, async () => {
      const result = await handleConnectTool();
      const json = JSON.stringify(result);

      expect(json).not.toContain('ENCRYPTION_KEY');
      expect(json).not.toContain('MCP_AUTH_SECRET');
      expect(json).not.toContain('client_secret');
      expect(json).not.toContain('access_token');
      expect(json).not.toContain('refresh_token');
    });
  });
});
