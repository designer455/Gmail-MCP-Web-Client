import { describe, it, expect, beforeEach } from 'vitest';
import { GmailClientService } from '../src/gmail/client.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';
import { GmailNotConnectedError } from '../src/utils/errors.js';

describe('GmailClientService & Token Refresh', () => {
  let store: MemoryTokenStore;

  beforeEach(() => {
    store = new MemoryTokenStore();
    // Use fresh store for each test
    const globalStore = getTokenStore() as MemoryTokenStore;
    if (globalStore.clear) {
      globalStore.clear();
    }
  });

  describe('9. Gmail Client Creation', () => {
    it('throws GmailNotConnectedError when current user has not connected Gmail', async () => {
      const user = createUserContext('unconnected-user');

      await runWithUserContext(user, async () => {
        await expect(GmailClientService.getClient()).rejects.toThrow(GmailNotConnectedError);
      });
    });

    it('creates Gmail client successfully for authenticated user with stored credentials', async () => {
      const user = createUserContext('connected-user');
      const tokenStore = getTokenStore();

      await tokenStore.saveUserCredentials('connected-user', {
        access_token: 'valid-test-access-token',
        refresh_token: 'valid-test-refresh-token',
        emailAddress: 'connected@example.com',
      });

      await runWithUserContext(user, async () => {
        const client = await GmailClientService.getClient();
        expect(client).toBeDefined();
        expect(client.userId).toBe('connected-user');
        expect(client.emailAddress).toBe('connected@example.com');
        expect(client.gmail).toBeDefined();
        expect(client.oauth2Client).toBeDefined();
      });
    });
  });

  describe('10. Token Refresh Handling', () => {
    it('persists newly emitted access tokens back into TokenStore', async () => {
      const user = createUserContext('refresh-test-user');
      const tokenStore = getTokenStore();

      await tokenStore.saveUserCredentials('refresh-test-user', {
        access_token: 'old-access-token',
        refresh_token: 'persistent-refresh-token',
        emailAddress: 'refresh@example.com',
      });

      await runWithUserContext(user, async () => {
        const client = await GmailClientService.getClient();

        // Simulate google-auth-library emitting 'tokens' event on refresh
        client.oauth2Client.emit('tokens', {
          access_token: 'refreshed-new-access-token',
          expiry_date: Date.now() + 3600000,
        });

        // Allow microtask to complete async save
        await new Promise((resolve) => setTimeout(resolve, 50));

        const updatedCreds = await tokenStore.getUserCredentials('refresh-test-user');
        expect(updatedCreds?.access_token).toBe('refreshed-new-access-token');
        expect(updatedCreds?.refresh_token).toBe('persistent-refresh-token'); // Kept intact
      });
    });
  });
});
