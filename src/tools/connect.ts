import { z } from 'zod';
import { getCurrentUser } from '../auth/session.js';
import { getTokenStore } from '../auth/token-store.js';
import { createGoogleLinkToken } from '../auth/link-token.js';
import { UnauthorizedError } from '../utils/errors.js';

export const connectToolSchema = z.object({}).strict();

export interface ConnectToolResult {
  connected: boolean;
  message: string;
  url?: string;
}

/**
 * Handler for gmail_connect
 * Allows ChatGPT or the user to explicitly request a one-time Google connection link
 * for the currently authenticated installation.
 * Reads installationId exclusively from the request session context.
 * Does not accept caller-supplied identifiers.
 * Does not expose secrets, tokens, or encryption keys.
 */
export async function handleConnectTool(): Promise<ConnectToolResult> {
  const user = getCurrentUser();
  if (!user.isAuthenticated || !user.userId || user.userId === 'anonymous') {
    throw new UnauthorizedError('Authentication required. Missing verified MCP access token.');
  }

  const tokenStore = getTokenStore();
  const isConnected = await tokenStore.hasUserCredentials(user.userId);

  if (isConnected) {
    return {
      connected: true,
      message: 'Gmail account is already connected.',
    };
  }

  const url = createGoogleLinkToken(user.userId);

  return {
    connected: false,
    message: 'Connect your Gmail account using the link below.',
    url,
  };
}
