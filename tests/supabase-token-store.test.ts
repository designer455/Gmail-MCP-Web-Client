import { describe, it, expect, beforeEach } from 'vitest';
import { SupabaseTokenStore, GmailAccountRow } from '../src/auth/supabase-token-store.js';
import {
  OAuthCredentials,
  getTokenStore,
  setTokenStore,
  resetTokenStore,
} from '../src/auth/token-store.js';
import { getSupabaseClient, resetSupabaseClient } from '../src/auth/supabase.js';
import { resetEnvCache } from '../src/config/env.js';
import { ConfigurationError } from '../src/utils/errors.js';

// Realistic in-memory mock for Supabase client
function createMockSupabaseClient() {
  const tableData: GmailAccountRow[] = [];

  const client = {
    _data: tableData,
    from(tableName: string) {
      if (tableName !== 'gmail_accounts') {
        throw new Error(`Unexpected table: ${tableName}`);
      }

      let currentData = [...tableData];
      let pendingInsert: any = null;
      let pendingUpdate: any = null;
      let isDelete = false;

      const builder: any = {
        select(columns?: string) {
          return builder;
        },
        eq(field: string, val: any) {
          if (pendingUpdate) {
            for (const row of tableData) {
              if ((row as any)[field] === val) {
                Object.assign(row, pendingUpdate);
              }
            }
          } else if (isDelete) {
            const indicesToRemove: number[] = [];
            tableData.forEach((row, i) => {
              if ((row as any)[field] === val) {
                indicesToRemove.push(i);
              }
            });
            for (let i = indicesToRemove.length - 1; i >= 0; i--) {
              tableData.splice(indicesToRemove[i], 1);
            }
          } else {
            currentData = currentData.filter((row: any) => row[field] === val);
          }
          return builder;
        },
        order(field: string, opts?: { ascending: boolean }) {
          currentData.sort((a: any, b: any) => {
            const valA = a[field] || '';
            const valB = b[field] || '';
            return opts?.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
          });
          return builder;
        },
        limit(n: number) {
          currentData = currentData.slice(0, n);
          return builder;
        },
        async maybeSingle() {
          return { data: currentData[0] || null, error: null };
        },
        insert(payload: any) {
          const row: GmailAccountRow = {
            id: payload.id || `id-${Date.now()}-${Math.random()}`,
            user_id: payload.user_id,
            google_account_id: payload.google_account_id || null,
            email: payload.email,
            encrypted_access_token: payload.encrypted_access_token,
            encrypted_refresh_token: payload.encrypted_refresh_token || null,
            token_expiry: payload.token_expiry || null,
            created_at: payload.created_at || new Date().toISOString(),
            updated_at: payload.updated_at || new Date().toISOString(),
          };
          tableData.push(row);
          return Promise.resolve({ data: row, error: null });
        },
        update(payload: any) {
          pendingUpdate = payload;
          return builder;
        },
        delete() {
          isDelete = true;
          return builder;
        },
        then(resolve: any) {
          return Promise.resolve({ data: currentData, error: null }).then(resolve);
        },
      };

      return builder;
    },
  };

  return client as any;
}

describe('SupabaseTokenStore Unit & Security Tests', () => {
  let mockClient: any;
  let store: SupabaseTokenStore;

  beforeEach(() => {
    resetTokenStore();
    resetSupabaseClient();
    resetEnvCache();
    mockClient = createMockSupabaseClient();
    store = new SupabaseTokenStore(mockClient);
  });

  // A. SupabaseTokenStore save
  it('A. saves OAuth credentials encrypted in Supabase', async () => {
    const creds: OAuthCredentials = {
      access_token: 'secret-access-token-123',
      refresh_token: 'secret-refresh-token-456',
      emailAddress: 'user@example.com',
      expiry_date: Date.now() + 3600000,
    };

    await store.saveUserCredentials('user-1', creds);
    expect(mockClient._data.length).toBe(1);
    expect(mockClient._data[0].user_id).toBe('user-1');
    expect(mockClient._data[0].email).toBe('user@example.com');
  });

  // B. SupabaseTokenStore retrieve
  it('B. retrieves and decrypts user credentials correctly', async () => {
    const creds: OAuthCredentials = {
      access_token: 'secret-access-token-123',
      refresh_token: 'secret-refresh-token-456',
      emailAddress: 'user@example.com',
      expiry_date: 1773918000000,
    };

    await store.saveUserCredentials('user-1', creds);
    const retrieved = await store.getUserCredentials('user-1');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.access_token).toBe('secret-access-token-123');
    expect(retrieved?.refresh_token).toBe('secret-refresh-token-456');
    expect(retrieved?.emailAddress).toBe('user@example.com');
    expect(retrieved?.expiry_date).toBe(1773918000000);
  });

  // C. SupabaseTokenStore update
  it('C. updates credentials without creating duplicate records', async () => {
    await store.saveUserCredentials('user-1', {
      access_token: 'initial-access-token',
      refresh_token: 'initial-refresh-token',
      emailAddress: 'user@example.com',
    });

    expect(mockClient._data.length).toBe(1);

    await store.saveUserCredentials('user-1', {
      access_token: 'updated-access-token',
      refresh_token: 'updated-refresh-token',
      emailAddress: 'user@example.com',
    });

    expect(mockClient._data.length).toBe(1);
    const updated = await store.getUserCredentials('user-1');
    expect(updated?.access_token).toBe('updated-access-token');
    expect(updated?.refresh_token).toBe('updated-refresh-token');
  });

  // D. user isolation
  it('D. guarantees strict isolation between distinct users', async () => {
    await store.saveUserCredentials('user-A', {
      access_token: 'token-A',
      refresh_token: 'refresh-A',
      emailAddress: 'usera@gmail.com',
    });

    await store.saveUserCredentials('user-B', {
      access_token: 'token-B',
      refresh_token: 'refresh-B',
      emailAddress: 'userb@gmail.com',
    });

    const credsA = await store.getUserCredentials('user-A');
    const credsB = await store.getUserCredentials('user-B');

    expect(credsA?.access_token).toBe('token-A');
    expect(credsA?.emailAddress).toBe('usera@gmail.com');

    expect(credsB?.access_token).toBe('token-B');
    expect(credsB?.emailAddress).toBe('userb@gmail.com');

    // Deleting User A must not affect User B
    await store.deleteUserCredentials('user-A');
    expect(await store.hasUserCredentials('user-A')).toBe(false);
    expect(await store.hasUserCredentials('user-B')).toBe(true);

    const checkB = await store.getUserCredentials('user-B');
    expect(checkB?.access_token).toBe('token-B');
  });

  // E. Google account isolation
  it('E. preserves google_account_id for account mapping', async () => {
    await store.saveUserCredentials('user-multi', {
      access_token: 'token-g1',
      refresh_token: 'refresh-g1',
      emailAddress: 'work@gmail.com',
      googleAccountId: 'google-sub-12345',
    });

    expect(mockClient._data[0].google_account_id).toBe('google-sub-12345');
    const retrieved = await store.getUserCredentials('user-multi');
    expect(retrieved?.googleAccountId).toBe('google-sub-12345');
  });

  // F. encrypted token persistence
  it('F. persists encrypted tokens at rest without plaintext leakage in DB', async () => {
    const rawAccessToken = 'ya29.very_confidential_google_access_token';
    const rawRefreshToken = '1//very_confidential_google_refresh_token';

    await store.saveUserCredentials('user-crypto', {
      access_token: rawAccessToken,
      refresh_token: rawRefreshToken,
      emailAddress: 'crypto@gmail.com',
    });

    const storedRow = mockClient._data[0];
    // Plaintext tokens MUST NOT be stored
    expect(storedRow.encrypted_access_token).not.toBe(rawAccessToken);
    expect(storedRow.encrypted_access_token).not.toContain(rawAccessToken);

    expect(storedRow.encrypted_refresh_token).not.toBe(rawRefreshToken);
    expect(storedRow.encrypted_refresh_token).not.toContain(rawRefreshToken);

    // Matches standard AES-256-GCM iv:authTag:cipher format
    expect(storedRow.encrypted_access_token.split(':')).toHaveLength(3);
    expect(storedRow.encrypted_refresh_token.split(':')).toHaveLength(3);
  });

  // G. decrypted token retrieval
  it('G. decrypts stored tokens correctly when requested', async () => {
    await store.saveUserCredentials('user-roundtrip', {
      access_token: 'my-clean-access-token',
      refresh_token: 'my-clean-refresh-token',
      emailAddress: 'roundtrip@gmail.com',
    });

    const retrieved = await store.getUserCredentials('user-roundtrip');
    expect(retrieved?.access_token).toBe('my-clean-access-token');
    expect(retrieved?.refresh_token).toBe('my-clean-refresh-token');
  });

  // H. token refresh persistence
  it('H. preserves existing refresh token when updated access token has no refresh token', async () => {
    // Initial OAuth authorization supplies both access and refresh tokens
    await store.saveUserCredentials('user-refresh', {
      access_token: 'initial-access',
      refresh_token: 'original-long-lived-refresh-token',
      emailAddress: 'refresh@gmail.com',
    });

    // Token refresh event occurs: Google emits a new access_token, but NO refresh_token
    await store.saveUserCredentials('user-refresh', {
      access_token: 'newly-refreshed-access-token',
      refresh_token: null, // Google refresh response did not include refresh_token
      emailAddress: 'refresh@gmail.com',
      expiry_date: Date.now() + 3600000,
    });

    const retrieved = await store.getUserCredentials('user-refresh');
    expect(retrieved?.access_token).toBe('newly-refreshed-access-token');
    // Original refresh token MUST NOT have been overwritten with null!
    expect(retrieved?.refresh_token).toBe('original-long-lived-refresh-token');
  });

  // I. duplicate account / upsert behavior
  it('I. handles multiple saves idempotently without creating duplicate rows', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveUserCredentials('user-idempotent', {
        access_token: `token-${i}`,
        refresh_token: 'same-refresh',
        emailAddress: 'idempotent@gmail.com',
      });
    }

    expect(mockClient._data.length).toBe(1);
    const retrieved = await store.getUserCredentials('user-idempotent');
    expect(retrieved?.access_token).toBe('token-4');
  });

  // J. missing Supabase environment variables
  it('J. fails clearly when SUPABASE_URL or SUPABASE_SECRET_KEY is missing', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    resetEnvCache();
    resetSupabaseClient();

    expect(() => getSupabaseClient()).toThrow(ConfigurationError);
    expect(() => getSupabaseClient()).toThrow(/Missing SUPABASE_URL or SUPABASE_SECRET_KEY/);
  });

  // K. production must not fall back to MemoryTokenStore
  it('K. production refuses to start with in-memory store and requires Supabase config', () => {
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    resetEnvCache();
    resetTokenStore();

    // Must throw Error and NOT fall back to MemoryTokenStore
    expect(() => getTokenStore()).toThrow(/SUPABASE_URL is required in production environment/);

    // When configured in production, returns SupabaseTokenStore
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'mock-secret-key';
    resetEnvCache();
    resetTokenStore();

    const prodStore = getTokenStore();
    expect(prodStore.getStoreType()).toContain('production-supabase');
    expect(prodStore.getStoreType()).not.toContain('development-memory');
  });
});
