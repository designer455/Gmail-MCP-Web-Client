import { describe, it, expect, vi } from 'vitest';
import { handleSearchTool } from '../src/tools/search.js';
import {
  handleBatchModifyLabelsTool,
  handleBatchArchiveTool,
  handleBatchMarkReadTool,
  handleBatchMarkUnreadTool,
  handleBatchTrashTool,
} from '../src/tools/batch.js';
import { handleGetAttachmentTool, handleSearchAttachmentsTool } from '../src/tools/attachments.js';
import { GmailClientService } from '../src/gmail/client.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';

describe('Reliable Search, Batch Operations & Attachments Tests', () => {
  const user = createUserContext('test-batch-user');

  describe('1. Full-Text Search & Diagnostics (gmail_search)', () => {
    it('searches with includeSpamTrash: true by default and returns diagnostics on 0 results', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [],
          resultSizeEstimate: 0,
        },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { list: mockList },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleSearchTool({ query: 'KreditBee' });

        expect(mockList).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'me',
            q: 'KreditBee',
            includeSpamTrash: true,
          })
        );

        expect(result.messages).toHaveLength(0);
        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics?.status).toBe('zero_results');
        expect(result.diagnostics?.query).toBe('KreditBee');
        expect(result.diagnostics?.includeSpamTrash).toBe(true);
        expect(result.diagnostics?.suggestions).toBeInstanceOf(Array);
        expect(result.diagnostics?.suggestions?.length).toBeGreaterThan(0);
      });
    });

    it('returns results and status=results_found when matching emails are found', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [{ id: 'msg-kreditbee-1', threadId: 'th-1' }],
          resultSizeEstimate: 1,
          nextPageToken: 'next-page-tok',
        },
      });
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-kreditbee-1',
          threadId: 'th-1',
          snippet: 'Your KreditBee EMI payment is due',
          payload: {
            headers: [
              { name: 'Subject', value: 'KreditBee Loan Statement' },
              { name: 'From', value: 'support@kreditbee.in' },
            ],
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
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleSearchTool({
          query: 'KreditBee OR Navi OR Loan',
          maxResults: 50,
          includeSpamTrash: true,
        });

        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].subject).toBe('KreditBee Loan Statement');
        expect(result.nextPageToken).toBe('next-page-tok');
        expect(result.diagnostics?.status).toBe('results_found');
      });
    });
  });

  describe('2. Batch Label Operations (gmail_batch_modify_labels)', () => {
    it('resolves friendly label name "Loans", creates label if missing, and executes batchModify', async () => {
      // Mock existing labels without "Loans"
      const mockLabelsList = vi.fn().mockResolvedValue({
        data: {
          labels: [{ id: 'INBOX', name: 'INBOX' }],
        },
      });
      const mockLabelsCreate = vi.fn().mockResolvedValue({
        data: {
          id: 'Label_Loans_123',
          name: 'Loans',
        },
      });
      const mockBatchModify = vi.fn().mockResolvedValue({ data: {} });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            labels: { list: mockLabelsList, create: mockLabelsCreate },
            messages: { batchModify: mockBatchModify },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleBatchModifyLabelsTool({
          messageIds: ['msg-1', 'msg-2', 'msg-3'],
          addLabelNames: ['Loans'],
        });

        // Verifies label "Loans" was auto-created
        expect(mockLabelsCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'me',
            requestBody: expect.objectContaining({ name: 'Loans' }),
          })
        );

        // Verifies batchModify was called with the new label ID
        expect(mockBatchModify).toHaveBeenCalledWith({
          userId: 'me',
          requestBody: {
            ids: ['msg-1', 'msg-2', 'msg-3'],
            addLabelIds: ['Label_Loans_123'],
            removeLabelIds: [],
          },
        });

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(3);
        expect(result.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
      });
    });

    it('batch archives messages by removing INBOX in bulk', async () => {
      const mockBatchModify = vi.fn().mockResolvedValue({ data: {} });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { batchModify: mockBatchModify },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleBatchArchiveTool({
          messageIds: ['msg-10', 'msg-20'],
        });

        expect(mockBatchModify).toHaveBeenCalledWith({
          userId: 'me',
          requestBody: {
            ids: ['msg-10', 'msg-20'],
            addLabelIds: [],
            removeLabelIds: ['INBOX'],
          },
        });
        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
      });
    });

    it('batch marks read and unread in bulk', async () => {
      const mockBatchModify = vi.fn().mockResolvedValue({ data: {} });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { batchModify: mockBatchModify },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        // Mark read
        await handleBatchMarkReadTool({ messageIds: ['msg-1'] });
        expect(mockBatchModify).toHaveBeenCalledWith({
          userId: 'me',
          requestBody: {
            ids: ['msg-1'],
            addLabelIds: [],
            removeLabelIds: ['UNREAD'],
          },
        });

        // Mark unread
        await handleBatchMarkUnreadTool({ messageIds: ['msg-1'] });
        expect(mockBatchModify).toHaveBeenCalledWith({
          userId: 'me',
          requestBody: {
            ids: ['msg-1'],
            addLabelIds: ['UNREAD'],
            removeLabelIds: [],
          },
        });
      });
    });

    it('batch trashes messages in chunks', async () => {
      const mockTrash = vi.fn().mockResolvedValue({ data: {} });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: { trash: mockTrash },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleBatchTrashTool({
          messageIds: ['msg-1', 'msg-2'],
        });

        expect(mockTrash).toHaveBeenCalledTimes(2);
        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
      });
    });
  });

  describe('3. Attachment Search & Retrieval', () => {
    it('searches attachments with keyword and filename filter, including spam/trash', async () => {
      const mockList = vi.fn().mockResolvedValue({
        data: {
          messages: [{ id: 'msg-attach-1', threadId: 'th-attach-1' }],
        },
      });
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-attach-1',
          threadId: 'th-attach-1',
          snippet: 'Attached statement',
          payload: {
            headers: [{ name: 'Subject', value: 'Loan Statement Attachment' }],
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
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const result = await handleSearchAttachmentsTool({
          query: 'KreditBee',
          filename: 'statement.pdf',
        });

        expect(mockList).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'me',
            q: expect.stringContaining('has:attachment KreditBee filename:statement.pdf'),
            includeSpamTrash: true,
          })
        );
        expect(result.messages).toHaveLength(1);
      });
    });

    it('retrieves attachment binary data and metadata via handleGetAttachmentTool', async () => {
      const mockMessageGet = vi.fn().mockResolvedValue({
        data: {
          id: 'msg-1',
          payload: {
            parts: [
              {
                filename: 'loan_statement.pdf',
                mimeType: 'application/pdf',
                body: { attachmentId: 'att-12345', size: 1024 },
              },
            ],
          },
        },
      });
      const mockAttachGet = vi.fn().mockResolvedValue({
        data: {
          data: 'JVBERi0xLjQKJcfs...', // base64url data
        },
      });

      vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
        gmail: {
          users: {
            messages: {
              get: mockMessageGet,
              attachments: { get: mockAttachGet },
            },
          },
        } as any,
        oauth2Client: {} as any,
        userId: 'test-batch-user',
      });

      await runWithUserContext(user, async () => {
        const attachment = await handleGetAttachmentTool({
          messageId: 'msg-1',
          attachmentId: 'att-12345',
        });

        expect(attachment.attachmentId).toBe('att-12345');
        expect(attachment.filename).toBe('loan_statement.pdf');
        expect(attachment.mimeType).toBe('application/pdf');
        expect(attachment.size).toBe(1024);
        expect(attachment.data).toBe('JVBERi0xLjQKJcfs...');
      });
    });
  });
});
