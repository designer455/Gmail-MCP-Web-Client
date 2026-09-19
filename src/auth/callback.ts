import { google } from 'googleapis';
import { validateOAuthState } from './state.js';
import { exchangeCodeForTokens, createOAuth2Client } from './oauth.js';
import { getTokenStore } from './token-store.js';
import { ValidationError, AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface CallbackResult {
  success: boolean;
  userId: string;
  emailAddress: string;
}

/**
 * Handles the OAuth 2.0 callback logic:
 * 1. Verifies code and state existence
 * 2. Validates state cryptographic integrity and freshness
 * 3. Exchanges code for access & refresh tokens
 * 4. Queries Gmail API to fetch the connected account's email address
 * 5. Saves credentials into the TokenStore under the authenticated user's ID
 */
export async function handleOAuthCallback(
  query: { code?: string; state?: string; error?: string },
  redirectUriOverride?: string
): Promise<CallbackResult> {
  const { code, state, error } = query;

  if (error) {
    logger.warn(`Google OAuth error returned: ${error}`);
    throw new AppError(`Google OAuth error: ${error}`, 400, 'OAUTH_PROVIDER_ERROR');
  }

  if (!code || typeof code !== 'string') {
    throw new ValidationError('Missing authorization code in OAuth callback');
  }

  if (!state || typeof state !== 'string') {
    throw new ValidationError('Missing state parameter in OAuth callback');
  }

  // 1. Validate state parameter (signature, expiration, replay)
  const statePayload = validateOAuthState(state);
  const { userId } = statePayload;

  // 2. Exchange authorization code for tokens
  logger.info(`Exchanging OAuth authorization code for user [${userId}]`);
  const credentials = await exchangeCodeForTokens(code, redirectUriOverride);

  // 3. Fetch user profile using the newly acquired tokens to discover email address
  const oauth2Client = createOAuth2Client(redirectUriOverride);
  oauth2Client.setCredentials({
    access_token: credentials.access_token || undefined,
    refresh_token: credentials.refresh_token || undefined,
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  let emailAddress = 'unknown';

  try {
    const profileRes = await gmail.users.getProfile({ userId: 'me' });
    emailAddress = profileRes.data.emailAddress || 'unknown';
  } catch (err) {
    logger.warn(`Could not retrieve profile email during callback: ${err}`);
  }

  credentials.emailAddress = emailAddress;

  // 4. Save credentials in TokenStore strictly associated with this user
  const tokenStore = getTokenStore();
  await tokenStore.saveUserCredentials(userId, credentials);

  logger.info(`Successfully saved Gmail OAuth credentials for user [${userId}] (${emailAddress})`);

  return {
    success: true,
    userId,
    emailAddress,
  };
}
