import { describe, it, expect, vi } from 'vitest';
import { searchToolSchema, handleSearchTool } from '../src/tools/search.js';
import {
  listMessagesToolSchema,
  getMessageToolSchema,
  handleListMessagesTool,
  handleGetMessageTool,
} from '../src/tools/messages.js';
import { getThreadToolSchema, handleGetThreadTool } from '../src/tools/threads.js';
import { GmailClientService } from '../src/gmail/client.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';

describe('Message and Thread Tools Validation & Execution', () => {
  const user = createUserContext('msg-user');

  describe('13. gmail_search validation', () => {
    it('validates required query and accepts valid search syntax', () => {
      expect(() =>
        searchToolSchema.parse({ query: 'from:billing@company.com is:unread' })
      ).not.toThrow();
      expect(() => searchToolSchema.parse({ query: '' })).toThrow();
      expect(() => searchToolSchema.parse({})).toThrow();
    });

    it('executes search using users.messages.list with userId="me"', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [{ id: 'msg-1', threadId: 'th-1' }],
          nextPageToken: 'token-page-2',
        },
      });
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-1',
          threadId: 'th-1',
          snippet: 'Important invoice',
          payload: {
            headers: [{ name: 'Subject', value: 'Invoice #101' }],
          },
        },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { list: mockList, get: mockGet },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'msg-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleSearchTool({ query: 'subject:Invoice', maxResults: 10 });
        expect(mockList).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'me',
            q: 'subject:Invoice',
            maxResults: 10,
          })
        );
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].subject).toBe('Invoice #101');
      });
    });
  });

  describe('14. gmail_list_messages validation', () => {
    it('validates options (maxResults, labelIds, pageToken)', () => {
      const parsed = listMessagesToolSchema.parse({
        maxResults: 50,
        labelIds: ['INBOX', 'IMPORTANT'],
        pageToken: 'tok123',
      });
      expect(parsed.maxResults).toBe(50);
      expect(parsed.labelIds).toEqual(['INBOX', 'IMPORTANT']);

      // Fails on invalid maxResults
      expect(() => listMessagesToolSchema.parse({ maxResults: 500 })).toThrow();
    });

    it('calls Gmail API with userId="me" and returns messages list', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: { messages: [] },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { list: mockList },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'msg-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleListMessagesTool({ maxResults: 10, labelIds: ['INBOX'] });
        expect(mockList).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'me',
            maxResults: 10,
            labelIds: ['INBOX'],
          })
        );
        expect(result.messages).toEqual([]);
      });
    });
  });

  describe('15. gmail_get_message validation', () => {
    it('validates messageId requirement', () => {
      expect(() => getMessageToolSchema.parse({ messageId: 'msg-123' })).not.toThrow();
      expect(() => getMessageToolSchema.parse({ messageId: '' })).toThrow();
      expect(() => getMessageToolSchema.parse({})).toThrow();
    });

    it('retrieves message with decoded body and headers for userId="me"', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-123',
          threadId: 'th-123',
          snippet: 'Hello World',
          payload: {
            headers: [
              { name: 'Subject', value: 'Project Update' },
              { name: 'From', value: 'alice@example.com' },
              { name: 'To', value: 'bob@example.com' },
              { name: 'Date', value: 'Sat, 19 Sep 2026 10:00:00 GMT' },
            ],
            body: {
              data: Buffer.from('Here is the latest status update.', 'utf8').toString('base64url'),
            },
          },
        },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { get: mockGet },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'msg-user',
      });

      await runWithUserContext(user, async () => {
        const msg = await handleGetMessageTool({ messageId: 'msg-123' });
        expect(mockGet).toHaveBeenCalledWith({
          userId: 'me',
          id: 'msg-123',
          format: 'full',
        });
        expect(msg.subject).toBe('Project Update');
        expect(msg.sender).toBe('alice@example.com');
        expect(msg.body).toBe('Here is the latest status update.');
      });
    });
  });

  describe('16. gmail_get_thread validation', () => {
    it('validates threadId requirement', () => {
      expect(() => getThreadToolSchema.parse({ threadId: 'th-999' })).not.toThrow();
      expect(() => getThreadToolSchema.parse({ threadId: '' })).toThrow();
      expect(() => getThreadToolSchema.parse({})).toThrow();
    });

    it('retrieves thread for userId="me"', async () => {
      const mockGetThread = vi.fn().mockResolvedValue({
        data: {
          id: 'th-999',
          messages: [
            {
              id: 'm1',
              threadId: 'th-999',
              snippet: 'First email',
              payload: { headers: [{ name: 'Subject', value: 'Thread title' }] },
            },
            {
              id: 'm2',
              threadId: 'th-999',
              snippet: 'Second reply',
              payload: { headers: [{ name: 'Subject', value: 'Re: Thread title' }] },
            },
          ],
        },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            threads: { get: mockGetThread },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'msg-user',
      });

      await runWithUserContext(user, async () => {
        const thread = await handleGetThreadTool({ threadId: 'th-999' });
        expect(mockGetThread).toHaveBeenCalledWith({
          userId: 'me',
          id: 'th-999',
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        expect(thread.messagesCount).toBe(2);
        expect(thread.id).toBe('th-999');
      });
    });
  });
});
