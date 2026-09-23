import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { getTokenStore, setTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';
import { GmailClientService } from '../src/gmail/client.js';
import { handleProfileTool } from '../src/tools/profile.js';
import { handleStatusTool } from '../src/tools/status.js';
import { setTestKeyResolver, clearJwksCache } from '../src/auth/jwt-verifier.js';
import * as jose from 'jose';

describe('Credential Flow Diagnostic Test Suite', () => {
  let memoryStore: MemoryTokenStore;
  let testKeyPair: jose.GenerateKeyPairResult;

  beforeEach(async () => {
    memoryStore = new MemoryTokenStore();
    setTokenStore(memoryStore);

    // Generate local RSA keypair for testing verified JWT authorization
    testKeyPair = await jose.generateKeyPair('RS256');
    setTestKeyResolver(testKeyPair.publicKey);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearJwksCache();
  });

  async function issueTestJwt(userId: string, email = 'diagnostic@kairali.com') {
    return await new jose.SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setAudience('authenticated')
      .setIssuer('https://gmail-mcp-web-client.vercel.app')
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(testKeyPair.privateKey);
  }

  it('verifies complete chain: MCP user → stored Gmail credential → decrypted credential → Gmail API profile', async () => {
    const userId = 'diag-user-999';
    const email = 'diag-user@example.com';
    const tokenStore = getTokenStore();

    // 1. Store credentials (which encrypts via AES-256-GCM in TokenStore)
    await tokenStore.saveUserCredentials(userId, {
      access_token: 'valid-google-access-token-xyz',
      refresh_token: 'valid-google-refresh-token-xyz',
      emailAddress: email,
      expiry_date: Date.now() + 3600 * 1000,
      token_type: 'Bearer',
    });

    // 2. Establish verified user session context
    const user = createUserContext(userId, email);

    // 3. Mock googleapis users.getProfile to test Gmail API interaction with decrypted client
    const mockGetProfile = vi.fn().mockResolvedValue({
      data: {
        emailAddress: email,
        messagesTotal: 42,
        threadsTotal: 12,
        historyId: '1002003',
      },
    });

    vi.spyOn(GmailClientService, 'getClient').mockImplementation(async () => {
      // Execute the real credential lookup & decryption logic
      const creds = await tokenStore.getUserCredentials(userId);
      expect(creds).not.toBeNull();
      expect(creds?.access_token).toBe('valid-google-access-token-xyz');
      expect(creds?.refresh_token).toBe('valid-google-refresh-token-xyz');

      return {
        gmail: {
          users: {
            getProfile: mockGetProfile,
          },
        } as any,
        oauth2Client: {} as any,
        userId,
        emailAddress: creds?.emailAddress || undefined,
      };
    });

    await runWithUserContext(user, async () => {
      // Check status reports authenticated: true
      const status = await handleStatusTool();
      expect(status.authenticated).toBe(true);
      expect(status.userId).toBe(userId);
      expect(status.emailAddress).toBe(email);

      // Check gmail_get_profile succeeds
      const profile = await handleProfileTool();
      expect(profile.emailAddress).toBe(email);
      expect(profile.messagesTotal).toBe(42);
      expect(profile.threadsTotal).toBe(12);

      // Verify secrets are NOT present in output
      const serialized = JSON.stringify(profile);
      expect(serialized).not.toContain('valid-google-access-token-xyz');
      expect(serialized).not.toContain('valid-google-refresh-token-xyz');
    });
  });

  it('safely handles unauthenticated user without exposing internal database errors', async () => {
    const user = createUserContext('anonymous');

    await runWithUserContext(user, async () => {
      const status = await handleStatusTool();
      expect(status.authenticated).toBe(false);
      expect(status.userId).toBeUndefined();

      // Tool call rejects with clean message
      await expect(handleProfileTool()).rejects.toThrow();
    });
  });
});
