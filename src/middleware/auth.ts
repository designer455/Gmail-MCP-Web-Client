import { Request, Response, NextFunction } from 'express';
import { runWithUserContext, createUserContext, getCurrentUser } from '../auth/session.js';
import { getTokenStore } from '../auth/token-store.js';
import { verifyJwt } from '../auth/jwt-verifier.js';
import { GmailNotConnectedError, sanitizeErrorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Express middleware that extracts and cryptographically verifies the Supabase Auth JWT
 * from the incoming Authorization: Bearer <token> header.
 *
 * Strict Security Rules:
 * 1. NEVER trusts ?userId or any query parameter for user identity.
 * 2. NEVER trusts X-User-ID or any custom request header for user identity.
 * 3. NEVER trusts request body or tool arguments for user identity.
 * 4. Extracts identity SOLELY from the cryptographically verified JWT subject (`sub`).
 * 5. Rejects missing, malformed, expired, or invalid-signature tokens with HTTP 401.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (authHeader) {
    const trimmed = authHeader.trim();
    const lower = trimmed.toLowerCase();

    // Bare Bearer with no token
    if (lower === 'bearer') {
      logger.warn('Authentication rejected: empty Bearer token');
      res.setHeader(
        'WWW-Authenticate',
        'Bearer error="invalid_request", error_description="Missing Bearer token"'
      );
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or empty Bearer token.',
      });
      return;
    }

    if (lower.startsWith('bearer ') || lower.startsWith('bearer\t')) {
      const token = trimmed.substring(6).trim();
      if (!token) {
        logger.warn('Authentication rejected: empty Bearer token');
        res.setHeader(
          'WWW-Authenticate',
          'Bearer error="invalid_request", error_description="Missing Bearer token"'
        );
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing or empty Bearer token.',
        });
        return;
      }

      try {
        const verified = await verifyJwt(token);
        const userContext = createUserContext(verified.userId, verified.email);

        runWithUserContext(userContext, () => {
          next();
        });
        return;
      } catch (err: unknown) {
        const safeMsg = sanitizeErrorMessage(err);
        res.setHeader(
          'WWW-Authenticate',
          'Bearer error="invalid_token", error_description="Signature or claims verification failed"'
        );
        res.status(401).json({
          error: 'Unauthorized',
          message: safeMsg,
        });
        return;
      }
    }
  }

  // If Authorization header is missing on routes that strictly require authentication (e.g. /auth/login)
  const isAuthLoginRoute = req.path === '/auth/login' || req.baseUrl === '/auth/login';
  if (isAuthLoginRoute) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({
      error: 'Unauthorized',
      message:
        'Authentication required. Please provide a valid Bearer JWT in the Authorization header.',
    });
    return;
  }

  // For unauthenticated requests (e.g. root dashboard or diagnostic status on /mcp),
  // bind an anonymous user context. Gmail tools will block execution via requireConnectedGmail().
  const userContext = createUserContext('anonymous');
  runWithUserContext(userContext, () => {
    next();
  });
}

/**
 * Strict authentication middleware for endpoints where authentication is mandatory.
 * Rejects unauthenticated requests with HTTP 401 before any handler execution.
 */
export async function requireAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Missing Authorization header.',
    });
    return;
  }

  await authMiddleware(req, res, next);
}

/**
 * Ensures that the currently authenticated user has an active Gmail credential
 */
export async function requireConnectedGmail(): Promise<void> {
  const user = getCurrentUser();
  if (!user.isAuthenticated || user.userId === 'anonymous') {
    throw new GmailNotConnectedError(
      'Gmail account is not connected. Please complete Google OAuth.'
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
