import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { sanitizeErrorMessage, AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Helmet middleware configuration for secure HTTP response headers
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
      connectSrc: ["'self'"],
      formAction: ["'self'", '*'],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * CORS middleware allowing ChatGPT and web clients
 */
export const corsMiddleware = cors({
  origin: true, // Echo origin or allow all configured origins
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'X-Requested-With'],
});

/**
 * Enforces HTTPS in production
 */
export function httpsEnforcer(req: Request, res: Response, next: NextFunction): void {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] &&
    req.headers['x-forwarded-proto'] !== 'https'
  ) {
    res.redirect(301, `https://${req.headers.host}${req.url}`);
    return;
  }
  next();
}

/**
 * Centralized Express error handler.
 * Prevents stack traces and sensitive error details from leaking to clients.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const errObj = err as { status?: number };
  const isSyntaxError = err instanceof SyntaxError && errObj.status === 400;
  const statusCode =
    err instanceof AppError ? err.statusCode : isSyntaxError ? 400 : errObj.status || 500;
  const safeMessage = isSyntaxError ? 'Parse error: Invalid JSON' : sanitizeErrorMessage(err);

  logger.error(`Handled request error [${statusCode}]: ${safeMessage}`);

  // Format as standard JSON-RPC 2.0 error if it's an MCP route
  if (req.path === '/mcp' || req.baseUrl === '/mcp') {
    res.status(statusCode).json({
      jsonrpc: '2.0',
      error: {
        code: isSyntaxError ? -32700 : -32603,
        message: safeMessage,
      },
      id: null,
    });
    return;
  }

  res.status(statusCode).json({
    success: false,
    error: safeMessage,
    code:
      err instanceof AppError ? err.code : isSyntaxError ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
  });
}
