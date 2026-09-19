/**
 * Centralized error hierarchy for Gmail MCP
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Sanitized error representation safe to return to clients/MCP tools.
   * Strips out internal paths, tokens, and stack traces.
   */
  public toSafeJSON(): { error: string; code: string } {
    return {
      error: this.message,
      code: this.code,
    };
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized: User is not authenticated') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class GmailNotConnectedError extends AppError {
  constructor(message = 'Gmail account is not connected. Please complete Google OAuth.') {
    super(message, 401, 'GMAIL_NOT_CONNECTED');
  }
}

export class InvalidOAuthStateError extends AppError {
  constructor(message = 'Invalid or forged OAuth state parameter.') {
    super(message, 400, 'INVALID_OAUTH_STATE');
  }
}

export class ExpiredOAuthStateError extends AppError {
  constructor(
    message = 'OAuth state parameter has expired. Please restart the authentication process.'
  ) {
    super(message, 400, 'EXPIRED_OAUTH_STATE');
  }
}

export class TokenRefreshError extends AppError {
  constructor(message = 'Failed to refresh Gmail access token. Re-authentication required.') {
    super(message, 401, 'TOKEN_REFRESH_FAILED');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Rate limit exceeded.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class GmailApiError extends AppError {
  constructor(message: string, statusCode = 502) {
    super(message, statusCode, 'GMAIL_API_ERROR');
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 500, 'CONFIGURATION_ERROR');
  }
}

/**
 * Sanitizes any raw unknown error into a safe client-facing message,
 * making sure secrets, stack traces, and tokens are NEVER leaked.
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error) {
    const rawMessage = error.message;

    // Check for sensitive patterns
    if (/token|secret|key|bearer|client_secret|refresh_token/i.test(rawMessage)) {
      return 'An authentication or security error occurred.';
    }

    // Gmail API common error strings
    if (rawMessage.includes('invalid_grant')) {
      return 'Gmail authorization expired or revoked. Please re-authenticate.';
    }
    if (rawMessage.includes('Insufficient Permission')) {
      return 'Insufficient Gmail API permissions for this operation.';
    }
    if (rawMessage.includes('Quota exceeded') || rawMessage.includes('rateLimitExceeded')) {
      return 'Gmail API rate limit or quota exceeded. Please try again shortly.';
    }

    return rawMessage;
  }

  return 'An unexpected error occurred.';
}
