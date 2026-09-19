import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleStatusTool } from '../src/tools/status.js';
import { handleProfileTool } from '../src/tools/profile.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';
import { GmailClientService } from '../src/gmail/client.js';

describe('Tools: Status and Profile', () => {
  beforeEach(() => {
    const globalStore = getTokenStore() as MemoryTokenStore;
    if (globalStore.clear) {
      globalStore.clear();
    }
  });

  describe('11. gmail_mcp_status', () => {
    it('returns safe diagnostic information without leaking secrets or credentials', async () => {
      const user = createUserContext('status-user');
      const tokenStore = getTokenStore();

      await tokenStore.saveUserCredentials('status-user', {
        access_token: 'secret-token-val',
        refresh_token: 'secret-refresh-val',
        emailAddress: 'user@example.com',
      });

      await runWithUserContext(user, async () => {
        const status = await handleStatusTool();

        expect(status.server).toBe('Gmail MCP');
        expect(status.version).toBe('1.0.0');
        expect(status.authenticated).toBe(true);
        expect(status.userId).toBe('status-user');
        expect(status.emailAddress).toBe('user@example.com');
        expect(status.tokenStore).toContain('NON-PRODUCTION TOKEN STORAGE');

        // CRITICAL CHECK: Ensure no secret keys or tokens exist in returned status
        const json = JSON.stringify(status);
        expect(json).not.toContain('secret-token-val');
        expect(json).not.toContain('secret-refresh-val');
        expect(json).not.toContain('client_secret');
        expect(json).not.toContain('ENCRYPTION_KEY');
      });
    });

    it('reports authenticated: false when user has not connected Gmail', async () => {
      const user = createUserContext('unauthenticated-user');

      await runWithUserContext(user, async () => {
        const status = await handleStatusTool();
        expect(status.authenticated).toBe(false);
      });
    });
  });

  describe('12. gmail_get_profile', () => {
    it('returns Gmail profile details for the authenticated user without allowing account selection', async () => {
      const user = createUserContext('profile-user');

      // Mock GmailClientService.getClient to return mock profile response
      const mockGetProfile = vi.fn().mockResolvedValue({
        data: {
          emailAddress: 'profile-user@gmail.com',
          messagesTotal: 1540,
          threadsTotal: 420,
          historyId: '987654',
        },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            getProfile: mockGetProfile,
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'profile-user',
        emailAddress: 'profile-user@gmail.com',
      });

      await runWithUserContext(user, async () => {
        const profile = await handleProfileTool();

        expect(mockGetProfile).toHaveBeenCalledWith({ userId: 'me' }); // Enforces 'me', prevents cross-account selection
        expect(profile.emailAddress).toBe('profile-user@gmail.com');
        expect(profile.messagesTotal).toBe(1540);
        expect(profile.threadsTotal).toBe(420);
      });
    });
  });
});
