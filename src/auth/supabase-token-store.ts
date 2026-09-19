import { SupabaseClient } from '@supabase/supabase-js';
import { TokenStore, OAuthCredentials } from './token-store.js';
import { getSupabaseClient } from './supabase.js';
import { encryptData, decryptData } from './crypto.js';
import { AppError, ValidationError, sanitizeErrorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface GmailAccountRow {
  id: string;
  user_id: string;
  google_account_id: string | null;
  email: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Production-ready TokenStore backed by Supabase PostgreSQL.
 *
 * Security guarantees:
 * - Credentials are encrypted at rest with AES-256-GCM prior to database insertion.
 * - Decryption occurs only in server memory; plaintext tokens are never logged or persisted.
 * - Every operation is strictly scoped to the authenticated application user (`user_id`).
 * - On token refresh, valid existing refresh tokens are preserved and never overwritten with NULL.
 */
export class SupabaseTokenStore implements TokenStore {
  private customClient?: SupabaseClient;

  constructor(client?: SupabaseClient) {
    if (client) {
      this.customClient = client;
    }
  }

  private get client(): SupabaseClient {
    return this.customClient || getSupabaseClient();
  }

  public async getUserCredentials(userId: string): Promise<OAuthCredentials | null> {
    if (!userId || userId === 'anonymous') {
      return null;
    }

    try {
      const { data, error } = await this.client
        .from('gmail_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error(
          `Database error retrieving credentials for user [${userId}]: ${sanitizeErrorMessage(error)}`
        );
        throw new AppError('Database error retrieving user credentials', 500, 'DATABASE_ERROR');
      }

      if (!data) {
        return null;
      }

      const row = data as GmailAccountRow;

      // Decrypt tokens strictly in memory
      let access_token: string | null = null;
      if (row.encrypted_access_token) {
        access_token = decryptData(row.encrypted_access_token);
      }

      let refresh_token: string | null = null;
      if (row.encrypted_refresh_token) {
        refresh_token = decryptData(row.encrypted_refresh_token);
      }

      const expiry_date = row.token_expiry ? new Date(row.token_expiry).getTime() : null;

      return {
        access_token,
        refresh_token,
        emailAddress: row.email,
        googleAccountId: row.google_account_id,
        expiry_date,
        token_type: 'Bearer',
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error(
        `Failed to decrypt or retrieve credentials for user [${userId}]: ${sanitizeErrorMessage(err)}`
      );
      return null;
    }
  }

  public async saveUserCredentials(userId: string, credentials: OAuthCredentials): Promise<void> {
    if (!userId || userId === 'anonymous') {
      throw new ValidationError('Cannot save credentials for empty or anonymous userId');
    }

    try {
      // 1. Encrypt new access token
      const encryptedAccess = credentials.access_token ? encryptData(credentials.access_token) : '';

      // 2. Check if account already exists for this user to preserve refresh_token if omitted
      const googleAccountId = credentials.googleAccountId || credentials.emailAddress || 'default';

      const { data: existingData, error: lookupError } = await this.client
        .from('gmail_accounts')
        .select('id, encrypted_refresh_token')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (lookupError) {
        logger.error(
          `Database lookup error during save for user [${userId}]: ${sanitizeErrorMessage(lookupError)}`
        );
        throw new AppError('Failed to verify existing user credentials', 500, 'DATABASE_ERROR');
      }

      const existingRecord = existingData as {
        id: string;
        encrypted_refresh_token: string | null;
      } | null;

      // 3. Reliable token refresh handling: never overwrite valid refresh token with NULL
      let encryptedRefresh: string | null = null;
      if (credentials.refresh_token) {
        encryptedRefresh = encryptData(credentials.refresh_token);
      } else if (existingRecord?.encrypted_refresh_token) {
        encryptedRefresh = existingRecord.encrypted_refresh_token;
      }

      const tokenExpiryIso = credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null;

      const now = new Date().toISOString();

      if (existingRecord) {
        // Idempotent Update
        const updatePayload: Record<string, unknown> = {
          email: credentials.emailAddress || undefined,
          google_account_id: googleAccountId,
          encrypted_access_token: encryptedAccess,
          token_expiry: tokenExpiryIso,
          updated_at: now,
        };

        if (encryptedRefresh) {
          updatePayload.encrypted_refresh_token = encryptedRefresh;
        }

        const { error: updateError } = await this.client
          .from('gmail_accounts')
          .update(updatePayload)
          .eq('id', existingRecord.id)
          .eq('user_id', userId);

        if (updateError) {
          logger.error(
            `Database update error for user [${userId}]: ${sanitizeErrorMessage(updateError)}`
          );
          throw new AppError('Failed to update user credentials', 500, 'DATABASE_ERROR');
        }
      } else {
        // Insert new record
        const insertPayload = {
          user_id: userId,
          google_account_id: googleAccountId,
          email: credentials.emailAddress || 'unknown',
          encrypted_access_token: encryptedAccess,
          encrypted_refresh_token: encryptedRefresh,
          token_expiry: tokenExpiryIso,
          created_at: now,
          updated_at: now,
        };

        const { error: insertError } = await this.client
          .from('gmail_accounts')
          .insert(insertPayload);

        if (insertError) {
          logger.error(
            `Database insert error for user [${userId}]: ${sanitizeErrorMessage(insertError)}`
          );
          throw new AppError('Failed to insert user credentials', 500, 'DATABASE_ERROR');
        }
      }
    } catch (err) {
      if (err instanceof AppError || err instanceof ValidationError) throw err;
      logger.error(
        `Unexpected error saving credentials for user [${userId}]: ${sanitizeErrorMessage(err)}`
      );
      throw new AppError('Failed to persist user credentials', 500, 'DATABASE_ERROR');
    }
  }

  public async deleteUserCredentials(userId: string): Promise<void> {
    if (!userId || userId === 'anonymous') {
      return;
    }

    try {
      const { error } = await this.client.from('gmail_accounts').delete().eq('user_id', userId);

      if (error) {
        logger.error(`Database delete error for user [${userId}]: ${sanitizeErrorMessage(error)}`);
        throw new AppError('Failed to delete user credentials', 500, 'DATABASE_ERROR');
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error(
        `Unexpected error deleting credentials for user [${userId}]: ${sanitizeErrorMessage(err)}`
      );
      throw new AppError('Failed to delete user credentials', 500, 'DATABASE_ERROR');
    }
  }

  public async hasUserCredentials(userId: string): Promise<boolean> {
    if (!userId || userId === 'anonymous') {
      return false;
    }

    try {
      const { data, error } = await this.client
        .from('gmail_accounts')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (error || !data) {
        return false;
      }

      return data.length > 0;
    } catch {
      return false;
    }
  }

  public getStoreType(): string {
    return 'production-supabase (ENCRYPTED POSTGRES STORAGE)';
  }
}
