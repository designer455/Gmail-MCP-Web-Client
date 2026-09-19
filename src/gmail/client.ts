import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getCurrentUser } from '../auth/session.js';
import { getTokenStore } from '../auth/token-store.js';
import { createOAuth2Client } from '../auth/oauth.js';
import { GmailNotConnectedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface AuthenticatedGmailClient {
  gmail: gmail_v1.Gmail;
  oauth2Client: OAuth2Client;
  userId: string;
  emailAddress?: string;
}

export class GmailClientService {
  /**
   * Retrieves the Gmail API client for the currently authenticated user.
   * Derives user strictly from session context (getCurrentUser).
   * Automatically refreshes expired access tokens and saves them to the TokenStore.
   */
  public static async getClient(): Promise<AuthenticatedGmailClient> {
    const user = getCurrentUser();
    if (!user.isAuthenticated || user.userId === 'anonymous') {
      throw new GmailNotConnectedError();
    }
    const tokenStore = getTokenStore();

    const credentials = await tokenStore.getUserCredentials(user.userId);
    if (!credentials || (!credentials.access_token && !credentials.refresh_token)) {
      throw new GmailNotConnectedError();
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: credentials.access_token || undefined,
      refresh_token: credentials.refresh_token || undefined,
      scope: credentials.scope || undefined,
      token_type: credentials.token_type || 'Bearer',
      expiry_date: credentials.expiry_date || undefined,
    });

    // Listen to token refresh events to automatically update the TokenStore
    oauth2Client.on('tokens', async (updatedTokens) => {
      logger.info(`Access token refreshed for user [${user.userId}]`);
      try {
        const latestCreds = (await tokenStore.getUserCredentials(user.userId)) || credentials;
        const mergedCreds = {
          ...latestCreds,
          access_token: updatedTokens.access_token || latestCreds.access_token,
          refresh_token: updatedTokens.refresh_token || latestCreds.refresh_token,
          expiry_date: updatedTokens.expiry_date || latestCreds.expiry_date,
        };
        await tokenStore.saveUserCredentials(user.userId, mergedCreds);
      } catch (err) {
        logger.error(`Failed to persist refreshed tokens for user [${user.userId}]: ${err}`);
      }
    });

    const gmail = google.gmail({
      version: 'v1',
      auth: oauth2Client,
    });

    return {
      gmail,
      oauth2Client,
      userId: user.userId,
      emailAddress: credentials.emailAddress || undefined,
    };
  }

  /**
   * Checks whether the currently authenticated user has an active Gmail credential in TokenStore
   */
  public static async isConnected(): Promise<boolean> {
    try {
      const user = getCurrentUser();
      const tokenStore = getTokenStore();
      return await tokenStore.hasUserCredentials(user.userId);
    } catch {
      return false;
    }
  }
}
