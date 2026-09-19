import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { getTokenStore } from '../auth/token-store.js';
import { getOptionalCurrentUser } from '../auth/session.js';

export const statusToolSchema = z.object({});

export interface ServerStatusResult {
  server: string;
  version: string;
  environment: string;
  gmailApiConfigured: boolean;
  oauthConfigured: boolean;
  authenticated: boolean;
  tokenStore: string;
  userId?: string;
  emailAddress?: string;
}

/**
 * Handler for gmail_mcp_status
 * Returns safe server state, configuration diagnostics, and current user status.
 * NEVER returns secrets, tokens, or encryption keys.
 */
export async function handleStatusTool(): Promise<ServerStatusResult> {
  const env = getEnv();
  const tokenStore = getTokenStore();
  const currentUser = getOptionalCurrentUser();

  let hasCredentials = false;
  let emailAddress: string | undefined = undefined;

  if (currentUser?.userId) {
    hasCredentials = await tokenStore.hasUserCredentials(currentUser.userId);
    if (hasCredentials) {
      const creds = await tokenStore.getUserCredentials(currentUser.userId);
      emailAddress = creds?.emailAddress || undefined;
    }
  }

  return {
    server: 'Gmail MCP',
    version: '1.0.0',
    environment: env.NODE_ENV,
    gmailApiConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    oauthConfigured: Boolean(env.GOOGLE_REDIRECT_URI),
    authenticated: hasCredentials,
    tokenStore: tokenStore.getStoreType(),
    userId: currentUser?.userId,
    emailAddress,
  };
}
