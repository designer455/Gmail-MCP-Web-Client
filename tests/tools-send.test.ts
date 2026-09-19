import { describe, it, expect, vi } from 'vitest';
import { sendToolSchema, handleSendTool } from '../src/tools/send.js';
import { composeRawEmail } from '../src/gmail/send.js';
import { GmailClientService } from '../src/gmail/client.js';
import { runWithUserContext, createUserContext } from '../src/auth/session.js';

describe('17. gmail_send Validation & Email Composition', () => {
  const user = createUserContext('sender-user');

  it('validates schema requirements for to, subject, and body', () => {
    // Valid input
    expect(() =>
      sendToolSchema.parse({
        to: 'recipient@example.com',
        subject: 'Hello',
        body: 'Email contents here',
      })
    ).not.toThrow();

    // Valid array of recipients
    expect(() =>
      sendToolSchema.parse({
        to: ['r1@example.com', 'r2@example.com'],
        cc: 'cc@example.com',
        subject: 'Meeting notes',
        body: 'Notes',
      })
    ).not.toThrow();

    // Missing to
    expect(() => sendToolSchema.parse({ subject: 'No to', body: 'Missing' })).toThrow();

    // Missing subject
    expect(() => sendToolSchema.parse({ to: 'r@example.com', body: 'Missing subject' })).toThrow();

    // Missing body
    expect(() => sendToolSchema.parse({ to: 'r@example.com', subject: 'Missing body' })).toThrow();

    // Disallows extra/arbitrary parameters like user_id or accountId
    expect(
      (sendToolSchema.parse({ to: 'r@example.com', subject: 'S', body: 'B' }) as any).user_id
    ).toBeUndefined();
  });

  it('composes an RFC 2822 base64url raw email string correctly', () => {
    const rawBase64Url = composeRawEmail(
      {
        to: 'alice@example.com',
        cc: ['bob@example.com', 'charlie@example.com'],
        subject: 'Test Subject',
        body: 'Hello Alice, this is a test message.',
      },
      'me@example.com'
    );

    // Verify it is valid base64url
    const decodedMime = Buffer.from(rawBase64Url, 'base64url').toString('utf8');

    expect(decodedMime).toContain('From: me@example.com');
    expect(decodedMime).toContain('To: alice@example.com');
    expect(decodedMime).toContain('Cc: bob@example.com, charlie@example.com');
    expect(decodedMime).toContain('Subject:');
    expect(decodedMime).toContain('Content-Type: text/plain; charset=UTF-8');
    // Body is base64 encoded in MIME
    const base64Body = Buffer.from('Hello Alice, this is a test message.', 'utf8').toString(
      'base64'
    );
    expect(decodedMime).toContain(base64Body);
  });

  it('sends email using users.messages.send with userId="me"', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      data: {
        id: 'sent-msg-123',
        threadId: 'sent-th-456',
      },
    });

    vi.spyOn(GmailClientService, 'getClient').mockResolvedValue({
      gmail: {
        users: {
          messages: { send: mockSend },
        },
      } as any,
      oauth2Client: {} as any,
      userId: 'sender-user',
      emailAddress: 'sender@example.com',
    });

    await runWithUserContext(user, async () => {
      const result = await handleSendTool({
        to: 'target@example.com',
        subject: 'Invoice Attached',
        body: 'Please find details below.',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me', // Strictly 'me'
          requestBody: expect.objectContaining({
            raw: expect.any(String),
          }),
        })
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('sent-msg-123');
      expect(result.threadId).toBe('sent-th-456');
    });
  });
});
