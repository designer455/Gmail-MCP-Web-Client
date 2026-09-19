import { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '../utils/errors.js';

interface ClientRecord {
  count: number;
  resetTime: number;
}

const clientRecords = new Map<string, ClientRecord>();

// Clean up stale client records every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of clientRecords.entries()) {
      if (now > record.resetTime) {
        clientRecords.delete(key);
      }
    }
  },
  5 * 60 * 1000
).unref();

/**
 * Creates an in-memory rate limiting middleware
 * @param maxRequests Maximum allowed requests in window
 * @param windowMs Time window in milliseconds (default 1 minute)
 */
export function rateLimiter(maxRequests = 120, windowMs = 60 * 1000) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key =
      (req.headers['x-user-id'] as string) ||
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      'anonymous';

    const now = Date.now();
    const record = clientRecords.get(key);

    if (!record || now > record.resetTime) {
      clientRecords.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      return next(new RateLimitError('Rate limit exceeded. Please slow down.'));
    }

    record.count++;
    next();
  };
}
