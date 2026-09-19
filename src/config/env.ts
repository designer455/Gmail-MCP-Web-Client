import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file if available
dotenv.config();

const envSchema = z
  .object({
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
    GOOGLE_REDIRECT_URI: z
      .string()
      .url('GOOGLE_REDIRECT_URI must be a valid URL')
      .default('https://gmail-mcp-web-client.vercel.app/api/auth/callback'),
    ENCRYPTION_KEY: z
      .string()
      .min(32, 'ENCRYPTION_KEY must be at least 32 characters long for AES-256-GCM')
      .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
    MCP_AUTH_SECRET: z
      .string()
      .min(16, 'MCP_AUTH_SECRET must be at least 16 characters long')
      .default('default_mcp_auth_secret_dev_32chars!'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL').optional(),
    SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY cannot be empty').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (!data.SUPABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SUPABASE_URL is required in production environment',
          path: ['SUPABASE_URL'],
        });
      }
      if (!data.SUPABASE_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SUPABASE_SECRET_KEY is required in production environment',
          path: ['SUPABASE_SECRET_KEY'],
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates and returns the loaded configuration.
 * Can be called with partial/custom env dictionary (e.g. during unit tests).
 */
export function parseEnv(customEnv?: Record<string, string | undefined>): EnvConfig {
  const source = customEnv || process.env;
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Environment validation failed: ${errorDetails}`);
  }

  return result.data;
}

let cachedEnv: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!cachedEnv) {
    // In test environment or default fallback when variables are not yet populated in CI
    const isTest = process.env.NODE_ENV === 'test';
    const fallbackEnv = isTest
      ? {
          GOOGLE_CLIENT_ID:
            process.env.GOOGLE_CLIENT_ID || 'test-client-id.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret',
          GOOGLE_REDIRECT_URI:
            process.env.GOOGLE_REDIRECT_URI ||
            'https://gmail-mcp-web-client.vercel.app/api/auth/callback',
          ENCRYPTION_KEY:
            process.env.ENCRYPTION_KEY ||
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          MCP_AUTH_SECRET: process.env.MCP_AUTH_SECRET || 'test_mcp_auth_secret_key_123456789',
          NODE_ENV: 'test',
          PORT: '3000',
        }
      : undefined;

    cachedEnv = parseEnv(fallbackEnv);
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
