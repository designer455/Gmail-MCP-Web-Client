import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';
import { ConfigurationError } from '../utils/errors.js';

let cachedClient: SupabaseClient | null = null;

/**
 * Creates or retrieves the singleton server-side Supabase client.
 * Uses SUPABASE_URL and SUPABASE_SECRET_KEY exclusively.
 *
 * CRITICAL SECURITY RULES:
 * - This module MUST only run on the server.
 * - Never bundle or expose this client to browser or frontend code.
 * - Never log or output SUPABASE_SECRET_KEY.
 */
export function getSupabaseClient(overrideUrl?: string, overrideKey?: string): SupabaseClient {
  if (overrideUrl && overrideKey) {
    return createClient(overrideUrl, overrideKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  if (!cachedClient) {
    const env = getEnv();
    const url = env.SUPABASE_URL;
    const secretKey = env.SUPABASE_SECRET_KEY;

    if (!url || !secretKey) {
      throw new ConfigurationError(
        'Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Supabase client initialization failed.'
      );
    }

    cachedClient = createClient(url, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedClient;
}

/**
 * Allows injecting or resetting the cached client (e.g. during test suites)
 */
export function setSupabaseClient(client: SupabaseClient | null): void {
  cachedClient = client;
}

export function resetSupabaseClient(): void {
  cachedClient = null;
}
