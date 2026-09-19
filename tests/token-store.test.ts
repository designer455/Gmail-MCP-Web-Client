import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryTokenStore, OAuthCredentials } from '../src/auth/token-store.js';
import { encryptCredentials, decryptCredentials } from '../src/auth/crypto.js';

describe('TokenStore & User Isolation', () => {
  let store: MemoryTokenStore;

  beforeEach(() => {
    store = new MemoryTokenStore();
  });

  describe('7. TokenStore', () => {
    it('performs CRUD operations for user credentials correctly', async () => {
      const userId = 'user-1';
      const creds: OAuthCredentials = {
        access_token: 'mock-access-token-123',
        refresh_token: 'mock-refresh-token-456',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        token_type: 'Bearer',
        expiry_date: Date.now() + 3600000,
        emailAddress: 'user1@example.com',
      };

      // Initially empty
      expect(await store.hasUserCredentials(userId)).toBe(false);
      expect(await store.getUserCredentials(userId)).toBeNull();

      // Save credentials
      await store.saveUserCredentials(userId, creds);
      expect(await store.hasUserCredentials(userId)).toBe(true);

      // Retrieve credentials
      const retrieved = await store.getUserCredentials(userId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.access_token).toBe(creds.access_token);
      expect(retrieved?.refresh_token).toBe(creds.refresh_token);
      expect(retrieved?.emailAddress).toBe('user1@example.com');

      // Delete credentials
      await store.deleteUserCredentials(userId);
      expect(await store.hasUserCredentials(userId)).toBe(false);
      expect(await store.getUserCredentials(userId)).toBeNull();
    });

    it('encrypts credentials using AES-256-GCM', () => {
      const creds = { access_token: 'secret-token-value', refresh_token: 'secret-refresh-value' };
      const encrypted = encryptCredentials(creds);

      // Encrypted string must not contain raw token plaintext
      expect(encrypted).not.toContain('secret-token-value');
      expect(encrypted).not.toContain('secret-refresh-value');
      expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

      // Decrypts accurately
      const decrypted = decryptCredentials<typeof creds>(encrypted);
      expect(decrypted.access_token).toBe(creds.access_token);
      expect(decrypted.refresh_token).toBe(creds.refresh_token);
    });

    it('clearly labels memory store as NON-PRODUCTION TOKEN STORAGE', () => {
      expect(store.getStoreType()).toContain('NON-PRODUCTION TOKEN STORAGE');
    });
  });

  describe('8. User Isolation', () => {
    it('guarantees complete isolation between multiple users in TokenStore', async () => {
      const userA = 'user-A';
      const userB = 'user-B';

      const credsA: OAuthCredentials = {
        access_token: 'token-for-user-A',
        refresh_token: 'refresh-for-user-A',
        emailAddress: 'usera@gmail.com',
      };

      const credsB: OAuthCredentials = {
        access_token: 'token-for-user-B',
        refresh_token: 'refresh-for-user-B',
        emailAddress: 'userb@gmail.com',
      };

      await store.saveUserCredentials(userA, credsA);
      await store.saveUserCredentials(userB, credsB);

      // Verify User A receives only User A's credentials
      const retrievedA = await store.getUserCredentials(userA);
      expect(retrievedA?.access_token).toBe('token-for-user-A');
      expect(retrievedA?.emailAddress).toBe('usera@gmail.com');

      // Verify User B receives only User B's credentials
      const retrievedB = await store.getUserCredentials(userB);
      expect(retrievedB?.access_token).toBe('token-for-user-B');
      expect(retrievedB?.emailAddress).toBe('userb@gmail.com');

      // Modifying or deleting User A has ZERO effect on User B
      await store.deleteUserCredentials(userA);
      expect(await store.hasUserCredentials(userA)).toBe(false);
      expect(await store.hasUserCredentials(userB)).toBe(true);

      const checkB = await store.getUserCredentials(userB);
      expect(checkB?.access_token).toBe('token-for-user-B');
    });
  });
});
