/**
 * Secure logging utility with sensitive data redaction.
 * Protects tokens, secrets, credentials, and email content from leaking to logs.
 */

export function redactSensitiveData(input: string): string {
  let sanitized = input;

  // Key-value patterns: redact the quoted or unquoted value
  sanitized = sanitized.replace(
    /("?(?:access_token|refreshToken|refresh_token|code|authorizationCode|client_secret|encryptionKey|secret|password|token|body|snippet|raw)"?\s*[:=]\s*)(["'])(?:(?!\2).)*\2/gi,
    '$1"[REDACTED]"'
  );

  // Direct tokens / secrets
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/GOCSPX-[A-Za-z0-9_-]+/gi, '[REDACTED]');
  sanitized = sanitized.replace(/ya29\.[A-Za-z0-9_-]+/gi, '[REDACTED]');
  sanitized = sanitized.replace(/4\/[0-9A-Za-z_-]+/gi, '[REDACTED]');

  return sanitized;
}

function formatLogItem(item: unknown): string {
  if (typeof item === 'string') {
    return redactSensitiveData(item);
  }
  if (item instanceof Error) {
    return redactSensitiveData(`${item.name}: ${item.message}`);
  }
  try {
    return redactSensitiveData(JSON.stringify(item));
  } catch {
    return '[Unstringifiable Object]';
  }
}

export const logger = {
  info: (message: string, ...args: unknown[]): void => {
    const safeArgs = args.map(formatLogItem).join(' ');
    console.log(`[INFO] ${redactSensitiveData(message)} ${safeArgs}`.trim());
  },
  warn: (message: string, ...args: unknown[]): void => {
    const safeArgs = args.map(formatLogItem).join(' ');
    console.warn(`[WARN] ${redactSensitiveData(message)} ${safeArgs}`.trim());
  },
  error: (message: string, ...args: unknown[]): void => {
    const safeArgs = args.map(formatLogItem).join(' ');
    console.error(`[ERROR] ${redactSensitiveData(message)} ${safeArgs}`.trim());
  },
  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.NODE_ENV === 'development') {
      const safeArgs = args.map(formatLogItem).join(' ');
      console.debug(`[DEBUG] ${redactSensitiveData(message)} ${safeArgs}`.trim());
    }
  },
};
