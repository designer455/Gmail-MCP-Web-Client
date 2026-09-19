import { describe, it, expect, beforeEach } from 'vitest';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import { GmailClientService } from '../src/gmail/client.js';
import { sanitizeErrorMessage, GmailNotConnectedError } from '../src/utils/errors.js';
import { redactSensitiveData } from '../src/utils/logger.js';
import { sendToolSchema } from '../src/tools/send.js';
import { searchToolSchema } from '../src/tools/search.js';
import { listMessagesToolSchema, getMessageToolSchema } from '../src/tools/messages.js';
import { getThreadToolSchema } from '../src/tools/threads.js';

describe('Security, Multi-User Isolation & Secret Leakage Prevention', () => {
  let store: MemoryTokenStore;

  beforeEach(() => {
    store = new MemoryTokenStore();
    const globalStore = getTokenStore() as MemoryTokenStore;
    if (globalStore.clear) {
      globalStore.clear();
    }
  });

  describe('18. Unauthorized Requests', () => {
    it('fails safely with clear message when user attempts Gmail operations without connection', async () => {
      const unauthSession = createUserContext('stranger-user');

      await runWithUserContext(unauthSession, async () => {
        try {
          await GmailClientService.getClient();
          expect.fail('Should have thrown GmailNotConnectedError');
        } catch (err) {
          expect(err).toBeInstanceOf(GmailNotConnectedError);
          const safeMsg = sanitizeErrorMessage(err);
          expect(safeMsg).toBe('Gmail account is not connected. Please complete Google OAuth.');
        }
      });
    });
  });

  describe('19. Cross-User Access Attempts', () => {
    it('strictly prevents client from supplying user_id or accountId to access other accounts', () => {
      // 1. Verify all tool schemas reject or strip user_id
      const sendInputWithUserId = {
        to: 'test@example.com',
        subject: 'Hi',
        body: 'Body',
        user_id: 'victim-user-123',
        accountId: 'victim-account',
      };

      const parsedSend = sendToolSchema.parse(sendInputWithUserId);
      expect((parsedSend as any).user_id).toBeUndefined();
      expect((parsedSend as any).accountId).toBeUndefined();

      const searchInput = { query: 'test', user_id: 'victim' };
      const parsedSearch = searchToolSchema.parse(searchInput);
      expect((parsedSearch as any).user_id).toBeUndefined();

      const getMsgInput = { messageId: 'm1', user_id: 'victim' };
      const parsedMsg = getMessageToolSchema.parse(getMsgInput);
      expect((parsedMsg as any).user_id).toBeUndefined();

      const getThreadInput = { threadId: 't1', user_id: 'victim' };
      const parsedThread = getThreadToolSchema.parse(getThreadInput);
      expect((parsedThread as any).user_id).toBeUndefined();

      const listInput = { user_id: 'victim' };
      const parsedList = listMessagesToolSchema.parse(listInput);
      expect((parsedList as any).user_id).toBeUndefined();
    });

    it('ensures User A execution context can NEVER access User B credentials in TokenStore', async () => {
      const userAContext = createUserContext('user-A');
      const userBContext = createUserContext('user-B');
      const tokenStore = getTokenStore();

      // Save credentials only for User B
      await tokenStore.saveUserCredentials('user-B', {
        access_token: 'user-b-secret-token',
        refresh_token: 'user-b-secret-refresh',
        emailAddress: 'userb@gmail.com',
      });

      // User A runs
      await runWithUserContext(userAContext, async () => {
        // User A must not be able to get Gmail client
        await expect(GmailClientService.getClient()).rejects.toThrow(GmailNotConnectedError);
        expect(await GmailClientService.isConnected()).toBe(false);
      });

      // User B runs
      await runWithUserContext(userBContext, async () => {
        expect(await GmailClientService.isConnected()).toBe(true);
        const clientB = await GmailClientService.getClient();
        expect(clientB.userId).toBe('user-B');
        expect(clientB.emailAddress).toBe('userb@gmail.com');
      });
    });
  });

  describe('20. Secret Leakage Prevention', () => {
    it('redacts tokens, client secrets, auth codes, and bearer keys from strings', () => {
      const sampleLogs = [
        'User authorized with access_token: "ya29.a0AfH6SMBabc123xyz"',
        'Client secret is "GOCSPX-MOCK_TEST_SECRET_ABC123456"',
        'Auth header: Bearer ya29.a0AfH6SMBabc123xyz',
        'Received code: "4/0AeanS0..." in callback',
      ];

      for (const logLine of sampleLogs) {
        const redacted = redactSensitiveData(logLine);
        expect(redacted).not.toContain('ya29.a0AfH6SMBabc123xyz');
        expect(redacted).not.toContain('GOCSPX-MOCK_TEST_SECRET_ABC123456');
        expect(redacted).not.toContain('4/0AeanS0...');
      }
    });

    it('sanitizes unknown errors to prevent credential or stack leakage', () => {
      const sensitiveError = new Error(
        'Failed connecting with refresh_token=secret123 and client_secret=GOCSPX-123'
      );
      const safe = sanitizeErrorMessage(sensitiveError);

      expect(safe).toBe('An authentication or security error occurred.');
      expect(safe).not.toContain('secret123');
      expect(safe).not.toContain('GOCSPX-123');
    });
  });
});
