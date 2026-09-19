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
  let userId = '';

  // 1. Primary authentication mechanism: Authorization: Bearer <credential>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    userId = authHeader.substring(7).trim();
  }

  // 2. Secondary mechanism: x-user-id header (for internal service-to-service calls)
  if (!userId && req.headers['x-user-id']) {
    userId = String(req.headers['x-user-id']).trim();
  }

  // 3. For non-MCP browser routes (like /auth/login or /), allow ?userId= parameter
  // CRITICAL SECURITY RULE: On /mcp, query parameters are NEVER trusted for user/account selection
  const isMcpRoute = req.path === '/mcp' || req.baseUrl === '/mcp';
  if (!userId && !isMcpRoute && req.query['userId']) {
    userId = String(req.query['userId']).trim();
  }

  // 4. Default fallback only in development environment for non-MCP routes
  if (!userId && process.env.NODE_ENV === 'development' && !isMcpRoute) {
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
  if (!user.isAuthenticated || user.userId === 'anonymous') {
    throw new GmailNotConnectedError(
      'Gmail account is not connected. Please complete Google OAuth or supply valid credentials.'
    );
  }

  const tokenStore = getTokenStore();
  const hasCredentials = await tokenStore.hasUserCredentials(user.userId);

  if (!hasCredentials) {
    throw new GmailNotConnectedError(
      'Gmail account is not connected. Please complete Google OAuth.'
    );
  }
}
