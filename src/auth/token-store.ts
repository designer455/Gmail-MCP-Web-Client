/**
 * ============================================================================
 * TOKEN STORE ABSTRACTION
 * ============================================================================
 * Defines the contract for storing and retrieving Google OAuth2 credentials per installation.
 * Implemented using Vercel Blob persistent storage with AES-256-GCM encryption at rest.
 * ============================================================================
 */

import {
  OAuthCredentials,
  saveGmailCredentials,
  getGmailCredentials,
  deleteGmailCredentials,
  hasGmailCredentials,
  isVercelBlobConfigured,
  clearInMemoryCredentialStore,
} from '../storage/gmail-credentials.js';
import { encryptCredentials, decryptCredentials } from './crypto.js';

export type { OAuthCredentials };

export interface TokenStore {
  getUserCredentials(installationId: string): Promise<OAuthCredentials | null>;
  saveUserCredentials(installationId: string, credentials: OAuthCredentials): Promise<void>;
  deleteUserCredentials(installationId: string): Promise<void>;
  hasUserCredentials(installationId: string): Promise<boolean>;
  getStoreType(): string;
}

/**
 * Production-ready TokenStore backed by Vercel Blob (with in-memory fallback for test/dev).
 */
export class VercelBlobTokenStore implements TokenStore {
  public async getUserCredentials(installationId: string): Promise<OAuthCredentials | null> {
    return await getGmailCredentials(installationId);
  }

  public async saveUserCredentials(
    installationId: string,
    credentials: OAuthCredentials
  ): Promise<void> {
    await saveGmailCredentials(installationId, credentials);
  }

  public async deleteUserCredentials(installationId: string): Promise<void> {
    await deleteGmailCredentials(installationId);
  }

  public async hasUserCredentials(installationId: string): Promise<boolean> {
    return await hasGmailCredentials(installationId);
  }

  public getStoreType(): string {
    return isVercelBlobConfigured()
      ? 'production-vercel-blob (ENCRYPTED BLOB STORAGE)'
      : 'development-blob-memory (NON-PRODUCTION TOKEN STORAGE)';
  }

  public clear(): void {
    clearInMemoryCredentialStore();
  }
}

/**
 * In-memory TokenStore for local development and test suites.
 */
export class MemoryTokenStore implements TokenStore {
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

  public clear(): void {
    this.store.clear();
    clearInMemoryCredentialStore();
  }
}

let activeTokenStore: TokenStore | null = null;

export function getTokenStore(): TokenStore {
  if (activeTokenStore) {
    return activeTokenStore;
  }

  activeTokenStore = new VercelBlobTokenStore();
  return activeTokenStore;
}

export function setTokenStore(store: TokenStore | null): void {
  activeTokenStore = store;
}

export function resetTokenStore(): void {
  activeTokenStore = null;
}
