/**
 * ============================================================================
 * TOKEN STORE ABSTRACTION
 * ============================================================================
 * Defines the contract for storing and retrieving Google OAuth2 credentials per user.
 *
 * NOTE FOR PHASE 1:
 * MemoryTokenStore below is strictly for:
 * [ NON-PRODUCTION TOKEN STORAGE - DEVELOPMENT / TESTING ONLY ]
 *
 * In Phase 2, a persistent encrypted database (e.g. Postgres / Supabase) will
 * implement this TokenStore interface without altering any Gmail or MCP business logic.
 * No tokens are stored on the Vercel filesystem, local JSON files, or browser storage.
 * ============================================================================
 */

import { encryptCredentials, decryptCredentials } from './crypto.js';

export interface OAuthCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
  emailAddress?: string | null;
}

export interface TokenStore {
  getUserCredentials(userId: string): Promise<OAuthCredentials | null>;
  saveUserCredentials(userId: string, credentials: OAuthCredentials): Promise<void>;
  deleteUserCredentials(userId: string): Promise<void>;
  hasUserCredentials(userId: string): Promise<boolean>;
  getStoreType(): string;
}

/**
 * ============================================================================
 * [ NON-PRODUCTION TOKEN STORAGE ]
 * In-memory TokenStore for local development and test suites.
 * In a serverless deployment (Vercel), in-memory state is ephemeral.
 * Encrypts credentials in-memory using AES-256-GCM to validate cryptographic flow.
 * ============================================================================
 */
export class MemoryTokenStore implements TokenStore {
  // Map of userId -> encrypted credential payload
  private readonly store = new Map<string, string>();

  public async getUserCredentials(userId: string): Promise<OAuthCredentials | null> {
    if (!userId) return null;
    const encrypted = this.store.get(userId);
    if (!encrypted) {
      return null;
    }
    try {
      return decryptCredentials<OAuthCredentials>(encrypted);
    } catch {
      return null;
    }
  }

  public async saveUserCredentials(userId: string, credentials: OAuthCredentials): Promise<void> {
    if (!userId) throw new Error('Cannot save credentials for empty userId');
    const encrypted = encryptCredentials(credentials);
    this.store.set(userId, encrypted);
  }

  public async deleteUserCredentials(userId: string): Promise<void> {
    this.store.delete(userId);
  }

  public async hasUserCredentials(userId: string): Promise<boolean> {
    return this.store.has(userId);
  }

  public getStoreType(): string {
    return 'development-memory (NON-PRODUCTION TOKEN STORAGE)';
  }

  /**
   * Helper for testing/cleanup
   */
  public clear(): void {
    this.store.clear();
  }
}

// Global default token store instance
let activeTokenStore: TokenStore = new MemoryTokenStore();

export function getTokenStore(): TokenStore {
  return activeTokenStore;
}

export function setTokenStore(store: TokenStore): void {
  activeTokenStore = store;
}
