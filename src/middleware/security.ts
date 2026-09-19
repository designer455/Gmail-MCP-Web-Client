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
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
      connectSrc: ["'self'"],
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
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-User-ID',
    'Accept',
    'Cache-Control',
    'X-Requested-With',
  ],
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
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const safeMessage = sanitizeErrorMessage(err);

  logger.error(`Handled request error [${statusCode}]: ${safeMessage}`);

  res.status(statusCode).json({
    success: false,
    error: safeMessage,
    code: err instanceof AppError ? err.code : 'INTERNAL_SERVER_ERROR',
  });
}
