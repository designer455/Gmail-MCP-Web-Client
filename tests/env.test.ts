import { describe, it, expect, beforeEach } from 'vitest';
import { parseEnv, resetEnvCache } from '../src/config/env.js';

describe('1. Environment Validation', () => {
  beforeEach(() => {
    resetEnvCache();
  });

  it('validates a valid environment configuration successfully', () => {
    const validEnv = {
      GOOGLE_CLIENT_ID: 'mock-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'mock-client-secret',
      GOOGLE_REDIRECT_URI: 'https://gmail-mcp-web-client.vercel.app/api/auth/callback',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      MCP_AUTH_SECRET: 'test_mcp_auth_secret_key_123456',
      NODE_ENV: 'development',
      PORT: '3000',
    };

    const parsed = parseEnv(validEnv);
    expect(parsed.GOOGLE_CLIENT_ID).toBe('mock-client-id.apps.googleusercontent.com');
    expect(parsed.GOOGLE_REDIRECT_URI).toBe(
      'https://gmail-mcp-web-client.vercel.app/api/auth/callback'
    );
    expect(parsed.PORT).toBe(3000);
  });

  it('fails if GOOGLE_CLIENT_ID is missing', () => {
    const invalidEnv = {
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
    };

    expect(() => parseEnv(invalidEnv)).toThrowError(/GOOGLE_CLIENT_ID is required/);
  });

  it('fails if GOOGLE_CLIENT_SECRET is missing', () => {
    const invalidEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: '',
    };

    expect(() => parseEnv(invalidEnv)).toThrowError(/GOOGLE_CLIENT_SECRET is required/);
  });

  it('fails if GOOGLE_REDIRECT_URI is not a valid URL', () => {
    const invalidEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
      GOOGLE_REDIRECT_URI: 'invalid-url',
    };

    expect(() => parseEnv(invalidEnv)).toThrowError(/must be a valid URL/);
  });

  it('fails if ENCRYPTION_KEY is too short (less than 32 chars)', () => {
    const invalidEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
      ENCRYPTION_KEY: 'short-key',
    };

    expect(() => parseEnv(invalidEnv)).toThrowError(
      /ENCRYPTION_KEY must be at least 32 characters/
    );
  });

  it('ensures DATABASE_URL is not required or defined in env config', () => {
    const parsed = parseEnv({
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
    });
    expect((parsed as any).DATABASE_URL).toBeUndefined();
  });

  it('fails in production if SUPABASE_URL is missing', () => {
    const prodEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
      NODE_ENV: 'production',
      SUPABASE_SECRET_KEY: 'mock-secret-key',
    };

    expect(() => parseEnv(prodEnv)).toThrowError(
      /SUPABASE_URL is required in production environment/
    );
  });

  it('fails in production if SUPABASE_SECRET_KEY is missing', () => {
    const prodEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    };

    expect(() => parseEnv(prodEnv)).toThrowError(
      /SUPABASE_SECRET_KEY is required in production environment/
    );
  });

  it('fails in production if SUPABASE_JWKS_URL is missing', () => {
    const prodEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'mock-secret-key',
    };

    expect(() => parseEnv(prodEnv)).toThrowError(
      /SUPABASE_JWKS_URL is required in production environment/
    );
  });

  it('succeeds in production when SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_JWKS_URL are provided', () => {
    const prodEnv = {
      GOOGLE_CLIENT_ID: 'mock-id',
      GOOGLE_CLIENT_SECRET: 'mock-secret',
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'mock-secret-key',
      SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    };

    const parsed = parseEnv(prodEnv);
    expect(parsed.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(parsed.SUPABASE_SECRET_KEY).toBe('mock-secret-key');
    expect(parsed.SUPABASE_JWKS_URL).toBe(
      'https://example.supabase.co/auth/v1/.well-known/jwks.json'
    );
  });
});
