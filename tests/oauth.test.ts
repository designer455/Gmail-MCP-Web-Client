import { describe, it, expect, beforeEach } from 'vitest';
import { getAuthorizationUrl, GMAIL_OAUTH_SCOPES } from '../src/auth/oauth.js';
import { generateOAuthState, validateOAuthState, clearConsumedNonces } from '../src/auth/state.js';
import { handleOAuthCallback } from '../src/auth/callback.js';
import {
  InvalidOAuthStateError,
  ExpiredOAuthStateError,
  ValidationError,
} from '../src/utils/errors.js';

describe('OAuth Flow & State Security', () => {
  beforeEach(() => {
    clearConsumedNonces();
  });

  describe('2. OAuth URL Generation', () => {
    it('generates a valid Google OAuth URL containing offline access, consent prompt, and Gmail scopes', () => {
      const userId = 'test-user-123';
      const { url, state } = getAuthorizationUrl(userId);

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain(`state=${encodeURIComponent(state)}`);

      // Verify that all 4 Gmail scopes are included
      for (const scope of GMAIL_OAUTH_SCOPES) {
        expect(url).toContain(encodeURIComponent(scope));
      }

      // Verify NO drive, contacts, or calendar scopes are present
      expect(url).not.toContain('drive');
      expect(url).not.toContain('contacts');
      expect(url).not.toContain('calendar');
    });
  });

  describe('3. OAuth State Generation', () => {
    it('generates a signed, tamper-proof state without secrets', () => {
      const userId = 'user-abc';
      const state = generateOAuthState(userId);

      expect(typeof state).toBe('string');
      expect(state.split('.')).toHaveLength(2);

      // Verify decoding payload
      const [encodedPayload] = state.split('.');
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

      expect(payload.userId).toBe('user-abc');
      expect(payload.timestamp).toBeGreaterThan(0);
      expect(payload.nonce).toBeDefined();
      expect(payload.secret).toBeUndefined(); // Must not contain secrets
    });
  });

  describe('4. OAuth State Validation', () => {
    it('successfully validates a freshly generated state', () => {
      const userId = 'user-xyz';
      const state = generateOAuthState(userId);

      const validated = validateOAuthState(state);
      expect(validated.userId).toBe(userId);
      expect(validated.nonce).toBeDefined();
    });

    it('rejects tampered state payload or signature', () => {
      const state = generateOAuthState('user-1');
      const [payload, sig] = state.split('.');

      // Tamper with payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ userId: 'attacker', timestamp: Date.now(), nonce: '123' })
      ).toString('base64url');

      expect(() => validateOAuthState(`${tamperedPayload}.${sig}`)).toThrow(InvalidOAuthStateError);

      // Tamper with signature
      const badSig = sig.replace(/^[0-9a-f]/, 'x');
      expect(() => validateOAuthState(`${payload}.${badSig}`)).toThrow(InvalidOAuthStateError);
    });

    it('rejects reused state (replay protection)', () => {
      const state = generateOAuthState('user-replay');
      // First validation succeeds
      const valid = validateOAuthState(state);
      expect(valid.userId).toBe('user-replay');

      // Replay attempt fails
      expect(() => validateOAuthState(state)).toThrow(InvalidOAuthStateError);
    });
  });

  describe('5. Expired State', () => {
    it('rejects expired OAuth state older than 10 minutes', () => {
      const customSecret = 'test_mcp_auth_secret_key_123456';
      // Create state with timestamp 15 minutes ago
      const expiredTimestamp = Date.now() - 15 * 60 * 1000;
      const payload = { userId: 'user-expired', timestamp: expiredTimestamp, nonce: 'exp123' };
      const payloadStr = JSON.stringify(payload);

      const crypto = require('crypto');
      const sig = crypto.createHmac('sha256', customSecret).update(payloadStr).digest('hex');
      const state = `${Buffer.from(payloadStr).toString('base64url')}.${sig}`;

      expect(() => validateOAuthState(state, customSecret)).toThrow(ExpiredOAuthStateError);
    });
  });

  describe('6. Invalid Callback', () => {
    it('rejects callback with missing code or state', async () => {
      await expect(handleOAuthCallback({ code: '', state: 'some-state' })).rejects.toThrow(
        ValidationError
      );
      await expect(handleOAuthCallback({ code: 'some-code', state: '' })).rejects.toThrow(
        ValidationError
      );
    });

    it('rejects callback when Google returns an error parameter', async () => {
      await expect(
        handleOAuthCallback({ error: 'access_denied', state: 'test' })
      ).rejects.toThrowError(/Google OAuth error: access_denied/);
    });
  });
});
