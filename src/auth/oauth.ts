import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getEnv } from '../config/env.js';
import { generateOAuthState } from './state.js';
import { OAuthCredentials } from './token-store.js';
import { logger } from '../utils/logger.js';

/**
 * Strict Gmail scopes per project specification:
 * - Read messages/threads
 * - Send messages
 * - Compose messages
 * - Modify labels/messages
 * NO Google Drive, Contacts, or Calendar scopes.
 */
export const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

/**
 * Creates an instance of Google OAuth2 client with system configuration.
 */
export function createOAuth2Client(redirectUriOverride?: string): OAuth2Client {
  const env = getEnv();
  const redirectUri = redirectUriOverride || env.GOOGLE_REDIRECT_URI;

  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

/**
 * Generates the Google OAuth 2.0 authorization URL for a specific user.
 * Generates a signed, tamper-proof state containing the user's ID.
 */
export function getAuthorizationUrl(
  userId: string,
  redirectUriOverride?: string
): { url: string; state: string } {
  const oauth2Client = createOAuth2Client(redirectUriOverride);
  const state = generateOAuthState(userId);

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Requests refresh_token
    prompt: 'consent', // Forces consent screen to ensure refresh_token is returned
    scope: [...GMAIL_OAUTH_SCOPES],
    state,
  });

  logger.info(`Generated OAuth authorization URL for user [${userId}]`);
  return { url, state };
}

/**
 * Exchanges an authorization code received at the callback for OAuth tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUriOverride?: string
): Promise<OAuthCredentials> {
  const oauth2Client = createOAuth2Client(redirectUriOverride);
  const { tokens } = await oauth2Client.getToken(code);

  return {
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    scope: tokens.scope || null,
    token_type: tokens.token_type || 'Bearer',
    expiry_date: tokens.expiry_date || null,
  };
}
