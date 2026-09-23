import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveGmailCredentials,
  getGmailCredentials,
  deleteGmailCredentials,
  hasGmailCredentials,
  getCredentialPathname,
  clearInMemoryCredentialStore,
} from '../src/storage/gmail-credentials.js';
import { getTokenStore, VercelBlobTokenStore } from '../src/auth/token-store.js';
import { generateInstallationId } from '../src/auth/installation.js';

describe('Vercel Blob Token Store & Multi-User Isolation', () => {
  beforeEach(() => {
    clearInMemoryCredentialStore();
  });

  it('generates correct Blob storage pathname strictly from installation ID', () => {
    const installId = generateInstallationId();
    const pathname = getCredentialPathname(installId);
    expect(pathname).toBe(`gmail-credentials/${installId}.json`);
    expect(pathname).not.toContain('@'); // Never uses email
  });

  it('saves, retrieves, and decrypts credentials in memory successfully', async () => {
    const installId = generateInstallationId();

    await saveGmailCredentials(installId, {
      access_token: 'test-access-token-12345',
      refresh_token: 'test-refresh-token-67890',
      emailAddress: 'test@example.com',
      expiry_date: Date.now() + 3600 * 1000,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    });

    const hasCreds = await hasGmailCredentials(installId);
    expect(hasCreds).toBe(true);

    const retrieved = await getGmailCredentials(installId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.access_token).toBe('test-access-token-12345');
    expect(retrieved?.refresh_token).toBe('test-refresh-token-67890');
    expect(retrieved?.emailAddress).toBe('test@example.com');
  });

  it('preserves existing refresh token if omitted during token refresh save', async () => {
    const installId = generateInstallationId();

    // 1. Initial save with refresh token
    await saveGmailCredentials(installId, {
      access_token: 'initial-access-token',
      refresh_token: 'persistent-refresh-token',
      emailAddress: 'refresh-test@example.com',
      expiry_date: Date.now() + 3600 * 1000,
    });

    // 2. Updated save omitting refresh_token (standard Google refresh response)
    await saveGmailCredentials(installId, {
      access_token: 'new-refreshed-access-token',
      refresh_token: null,
      emailAddress: 'refresh-test@example.com',
      expiry_date: Date.now() + 7200 * 1000,
    });

    const retrieved = await getGmailCredentials(installId);
    expect(retrieved?.access_token).toBe('new-refreshed-access-token');
    expect(retrieved?.refresh_token).toBe('persistent-refresh-token'); // Preserved!
  });

  it('enforces strict multi-user / multi-installation isolation', async () => {
    const installA = generateInstallationId();
    const installB = generateInstallationId();

    await saveGmailCredentials(installA, {
      access_token: 'token-A',
      emailAddress: 'user-a@example.com',
    });

    await saveGmailCredentials(installB, {
      access_token: 'token-B',
      emailAddress: 'user-b@example.com',
    });

    // Verify Installation A gets only A
    const credsA = await getGmailCredentials(installA);
    expect(credsA?.access_token).toBe('token-A');
    expect(credsA?.emailAddress).toBe('user-a@example.com');

    // Verify Installation B gets only B
    const credsB = await getGmailCredentials(installB);
    expect(credsB?.access_token).toBe('token-B');
    expect(credsB?.emailAddress).toBe('user-b@example.com');

    // Delete A should not affect B
    await deleteGmailCredentials(installA);
    expect(await hasGmailCredentials(installA)).toBe(false);
    expect(await hasGmailCredentials(installB)).toBe(true);
    expect((await getGmailCredentials(installB))?.access_token).toBe('token-B');
  });

  it('handles missing credentials cleanly by returning null', async () => {
    const nonExistent = generateInstallationId();
    const result = await getGmailCredentials(nonExistent);
    expect(result).toBeNull();
    expect(await hasGmailCredentials(nonExistent)).toBe(false);
  });

  it('TokenStore abstraction delegates to VercelBlobTokenStore seamlessly', async () => {
    const tokenStore = getTokenStore();
    expect(tokenStore).toBeInstanceOf(VercelBlobTokenStore);

    const installId = generateInstallationId();
    await tokenStore.saveUserCredentials(installId, {
      access_token: 'store-access-token',
      emailAddress: 'store@example.com',
    });

    expect(await tokenStore.hasUserCredentials(installId)).toBe(true);
    const creds = await tokenStore.getUserCredentials(installId);
    expect(creds?.access_token).toBe('store-access-token');
  });
});
