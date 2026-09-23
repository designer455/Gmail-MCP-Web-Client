import { put, get, del, head } from '@vercel/blob';
import { encryptData, decryptData } from '../auth/crypto.js';
import { getEnv } from '../config/env.js';
import { AppError, ValidationError, sanitizeErrorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface OAuthCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
  emailAddress?: string | null;
  googleAccountId?: string | null;
}

export interface StoredGmailCredentialJson {
  version: number;
  installationId: string;
  googleAccountId: string | null;
  email: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenExpiry: string | null;
  scope?: string | null;
  tokenType?: string | null;
  createdAt: string;
  updatedAt: string;
}

// In-memory fallback store for local development and offline test suites
const inMemoryStore = new Map<string, StoredGmailCredentialJson>();

export function clearInMemoryCredentialStore(): void {
  inMemoryStore.clear();
}

/**
 * Returns the Blob storage path for an installation ID.
 * Strict format: gmail-credentials/<installationId>.json
 */
export function getCredentialPathname(installationId: string): string {
  const cleanId = installationId.trim();
  return `gmail-credentials/${cleanId}.json`;
}

/**
 * Determines whether live Vercel Blob storage is configured.
 */
export function isVercelBlobConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Saves Gmail credentials to Vercel Blob (or in-memory fallback during test/dev).
 * Encrypts sensitive tokens at rest using AES-256-GCM.
 */
export async function saveGmailCredentials(
  installationId: string,
  credentials: OAuthCredentials
): Promise<void> {
  if (!installationId || installationId === 'anonymous') {
    throw new ValidationError('Cannot save credentials for empty or anonymous installationId');
  }

  const pathname = getCredentialPathname(installationId);
  const now = new Date().toISOString();

  // Encrypt sensitive access token
  const encryptedAccessToken = credentials.access_token
    ? encryptData(credentials.access_token)
    : '';

  // Look up existing record to preserve refresh token if omitted during refresh
  const existing = await getStoredCredentialJson(installationId);

  let encryptedRefreshToken: string | null = null;
  if (credentials.refresh_token) {
    encryptedRefreshToken = encryptData(credentials.refresh_token);
  } else if (existing?.encryptedRefreshToken) {
    encryptedRefreshToken = existing.encryptedRefreshToken;
  }

  const tokenExpiry = credentials.expiry_date
    ? new Date(credentials.expiry_date).toISOString()
    : null;

  const storedObject: StoredGmailCredentialJson = {
    version: 1,
    installationId,
    googleAccountId: credentials.googleAccountId || existing?.googleAccountId || null,
    email: credentials.emailAddress || existing?.email || 'unknown',
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiry,
    scope: credentials.scope || existing?.scope || null,
    tokenType: credentials.token_type || 'Bearer',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const jsonPayload = JSON.stringify(storedObject, null, 2);

  // If live Vercel Blob token is configured, persist to Blob
  if (isVercelBlobConfigured()) {
    try {
      // Default to private blob access; fallback to public if private is not enabled on account
      try {
        await put(pathname, jsonPayload, {
          access: 'private',
          addRandomSuffix: false,
          contentType: 'application/json',
        });
      } catch (accessErr: unknown) {
        const msg = String(accessErr);
        if (msg.includes('access must be') || msg.includes('private')) {
          await put(pathname, jsonPayload, {
            access: 'public',
            addRandomSuffix: false,
            contentType: 'application/json',
          });
        } else {
          throw accessErr;
        }
      }
      logger.info(`Persisted encrypted Gmail credentials to Vercel Blob for [${installationId}]`);
    } catch (err: unknown) {
      logger.error(
        `Failed to write credentials to Vercel Blob for [${installationId}]: ${sanitizeErrorMessage(err)}`
      );
      throw new AppError('Failed to persist credentials to Vercel Blob', 500, 'STORAGE_ERROR');
    }
  } else {
    // Development / test in-memory fallback
    inMemoryStore.set(pathname, storedObject);
    logger.info(`Persisted encrypted Gmail credentials to in-memory store for [${installationId}]`);
  }
}

/**
 * Retrieves and decrypts Gmail credentials for an installation ID.
 * Decryption occurs STRICTLY in memory.
 */
export async function getGmailCredentials(
  installationId: string
): Promise<OAuthCredentials | null> {
  if (!installationId || installationId === 'anonymous') {
    return null;
  }

  const stored = await getStoredCredentialJson(installationId);
  if (!stored) {
    return null;
  }

  try {
    let access_token: string | null = null;
    if (stored.encryptedAccessToken) {
      access_token = decryptData(stored.encryptedAccessToken);
    }

    let refresh_token: string | null = null;
    if (stored.encryptedRefreshToken) {
      refresh_token = decryptData(stored.encryptedRefreshToken);
    }

    const expiry_date = stored.tokenExpiry ? new Date(stored.tokenExpiry).getTime() : null;

    return {
      access_token,
      refresh_token,
      emailAddress: stored.email,
      googleAccountId: stored.googleAccountId,
      expiry_date,
      scope: stored.scope || null,
      token_type: stored.tokenType || 'Bearer',
    };
  } catch {
    logger.error(
      `Decryption failed for installation [${installationId}]: active ENCRYPTION_KEY mismatch. Reconnection required.`
    );
    throw new AppError(
      'Stored credentials could not be decrypted with active encryption key. Reconnection required.',
      401,
      'CREDENTIAL_DECRYPTION_FAILED'
    );
  }
}

/**
 * Deletes the stored credentials for an installation ID.
 */
export async function deleteGmailCredentials(installationId: string): Promise<void> {
  if (!installationId || installationId === 'anonymous') {
    return;
  }

  const pathname = getCredentialPathname(installationId);

  if (isVercelBlobConfigured()) {
    try {
      await del(pathname);
      logger.info(`Deleted credentials from Vercel Blob for [${installationId}]`);
    } catch (err: unknown) {
      logger.error(
        `Failed to delete credentials from Vercel Blob for [${installationId}]: ${sanitizeErrorMessage(err)}`
      );
      throw new AppError('Failed to delete credentials from storage', 500, 'STORAGE_ERROR');
    }
  } else {
    inMemoryStore.delete(pathname);
  }
}

/**
 * Checks whether an installation has stored Gmail credentials.
 */
export async function hasGmailCredentials(installationId: string): Promise<boolean> {
  if (!installationId || installationId === 'anonymous') {
    return false;
  }

  const pathname = getCredentialPathname(installationId);

  if (isVercelBlobConfigured()) {
    try {
      const res = await head(pathname).catch(() => null);
      return Boolean(res);
    } catch {
      return false;
    }
  }

  return inMemoryStore.has(pathname);
}

/**
 * Internal helper to read and parse the stored JSON file from Blob or in-memory store.
 */
async function getStoredCredentialJson(
  installationId: string
): Promise<StoredGmailCredentialJson | null> {
  const pathname = getCredentialPathname(installationId);

  if (isVercelBlobConfigured()) {
    try {
      let blobResult;
      try {
        blobResult = await get(pathname, { access: 'private', useCache: false });
      } catch (accessErr: unknown) {
        const msg = String(accessErr);
        if (msg.includes('access must be') || msg.includes('private')) {
          blobResult = await get(pathname, { access: 'public', useCache: false });
        } else {
          throw accessErr;
        }
      }

      if (!blobResult || !blobResult.stream) {
        return null;
      }

      const text = await new Response(blobResult.stream).text();
      const parsed = JSON.parse(text) as StoredGmailCredentialJson;
      return parsed;
    } catch (err: unknown) {
      const safe = sanitizeErrorMessage(err);
      if (safe.includes('404') || safe.includes('not found')) {
        return null;
      }
      logger.error(`Error reading Vercel Blob for [${installationId}]: ${safe}`);
      return null;
    }
  }

  return inMemoryStore.get(pathname) || null;
}
