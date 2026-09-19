import { Request, Response, NextFunction } from 'express';
import { runWithUserContext, createUserContext, getCurrentUser } from '../auth/session.js';
import { getTokenStore } from '../auth/token-store.js';
import { GmailNotConnectedError } from '../utils/errors.js';

/**
 * Express middleware that extracts the authenticated application user identity
 * from incoming HTTP/SSE headers or query parameters and binds it to the AsyncLocalStorage
 * execution context for the duration of the request.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // 1. Check custom user header
  let userId = (req.headers['x-user-id'] as string) || '';

  // 2. Check Bearer token (can represent session token or user ID)
  const authHeader = req.headers['authorization'];
  if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
    userId = authHeader.substring(7).trim();
  }

  // 3. Optional query parameter for local development / testing
  if (!userId && req.query['userId']) {
    userId = String(req.query['userId']).trim();
  }

  // 4. Default fallback in development environment only if not specified
  if (!userId && process.env.NODE_ENV !== 'production') {
    userId = 'dev-user-default';
  }

  // Bind the user context to the current asynchronous execution flow
  const userContext = createUserContext(userId || 'anonymous');
  runWithUserContext(userContext, () => {
    next();
  });
}

/**
 * Ensures that the currently authenticated user has an active Gmail credential
 */
export async function requireConnectedGmail(): Promise<void> {
  const user = getCurrentUser();
  const tokenStore = getTokenStore();
  const hasCredentials = await tokenStore.hasUserCredentials(user.userId);

  if (!hasCredentials) {
    throw new GmailNotConnectedError(
      'Gmail account is not connected. Please complete Google OAuth.'
    );
  }
}
