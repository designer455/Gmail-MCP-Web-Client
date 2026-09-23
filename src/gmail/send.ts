import { GmailClientService } from './client.js';
import { GmailApiError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface SendEmailOptions {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId: string;
  threadId: string;
}

/**
 * Formats a recipient array or comma-separated string into RFC 2822 header
 */
function formatRecipients(recipients: string | string[] | undefined): string {
  if (!recipients) return '';
  if (Array.isArray(recipients)) {
    return recipients.join(', ');
  }
  return recipients;
}

/**
 * Composes an RFC 2822 compliant MIME email and encodes it as base64url.
 */
export function composeRawEmail(options: SendEmailOptions, fromEmail?: string): string {
  const lines: string[] = [];

  if (fromEmail) {
    lines.push(`From: ${fromEmail}`);
  }

  const to = formatRecipients(options.to);
  if (!to) {
    throw new ValidationError('At least one recipient in "to" is required.');
  }
  lines.push(`To: ${to}`);

  const cc = formatRecipients(options.cc);
  if (cc) {
    lines.push(`Cc: ${cc}`);
  }

  const bcc = formatRecipients(options.bcc);
  if (bcc) {
    lines.push(`Bcc: ${bcc}`);
  }

  // Encode subject in UTF-8 Base64 RFC 2047 if non-ASCII
  const encodedSubject = Buffer.from(options.subject || '', 'utf8').toString('base64');
  lines.push(`Subject: =?utf-8?B?${encodedSubject}?=`);

  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
  }
  if (options.references) {
    lines.push(`References: ${options.references}`);
  }

  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');

  // Email body encoded in base64
  const bodyBase64 = Buffer.from(options.body || '', 'utf8').toString('base64');
  lines.push(bodyBase64);

  const rawMime = lines.join('\r\n');
  return Buffer.from(rawMime, 'utf8').toString('base64url');
}

/**
 * Sends an email using the CURRENT user's authenticated Gmail account.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { gmail, userId, emailAddress } = await GmailClientService.getClient();

  if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
    throw new ValidationError('Email recipient "to" is required.');
  }
  if (typeof options.subject !== 'string') {
    throw new ValidationError('Email "subject" is required.');
  }
  if (typeof options.body !== 'string') {
    throw new ValidationError('Email "body" is required.');
  }

  const rawMessage = composeRawEmail(options, emailAddress);

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawMessage,
        threadId: options.threadId || undefined,
      },
    });

    const sentMessageId = response.data.id || '';
    const sentThreadId = response.data.threadId || '';

    logger.info(
      `Email sent successfully for user [${userId}] (messageId: ${sentMessageId}, threadId: ${sentThreadId})`
    );

    return {
      success: true,
      messageId: sentMessageId,
      threadId: sentThreadId,
    };
  } catch (error: unknown) {
    logger.error(`Error sending email for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to send email through Gmail API.');
  }
}

/**
 * Replies to an existing message/thread. Automatically sets threadId, In-Reply-To, References,
 * and prepends "Re: " to the subject if not already present.
 */
export async function replyToMessage(
  messageId: string,
  options: Omit<SendEmailOptions, 'threadId' | 'inReplyTo'>
): Promise<SendEmailResult> {
  const { gmail, userId, emailAddress } = await GmailClientService.getClient();

  if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
    throw new ValidationError('Reply recipient "to" is required.');
  }

  try {
    // Fetch the original message for thread metadata
    const origRes = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'Message-ID', 'References', 'From'],
    });

    const orig = origRes.data;
    const headers = orig.payload?.headers || [];
    const getH = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const origMessageId = getH('Message-ID');
    const origReferences = getH('References');
    const origSubject = getH('Subject');

    const replySubject =
      options.subject ||
      (origSubject.toLowerCase().startsWith('re:') ? origSubject : `Re: ${origSubject}`);

    const references = origReferences ? `${origReferences} ${origMessageId}`.trim() : origMessageId;

    const sendOptions: SendEmailOptions = {
      ...options,
      subject: replySubject,
      threadId: orig.threadId || undefined,
      inReplyTo: origMessageId || undefined,
      references: references || undefined,
    };

    const raw = composeRawEmail(sendOptions, emailAddress);

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        threadId: orig.threadId || undefined,
      },
    });

    const sentId = response.data.id || '';
    const sentThreadId = response.data.threadId || '';
    logger.info(`Replied to message [${messageId}] as [${sentId}] for user [${userId}]`);

    return { success: true, messageId: sentId, threadId: sentThreadId };
  } catch (error: unknown) {
    if (error instanceof ValidationError) throw error;
    logger.error(`Error replying to message [${messageId}] for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to send reply through Gmail API.');
  }
}

/**
 * Forwards a message to new recipients, quoting the original body.
 */
export async function forwardMessage(
  messageId: string,
  to: string | string[],
  additionalBody?: string
): Promise<SendEmailResult> {
  const { gmail, userId, emailAddress } = await GmailClientService.getClient();

  try {
    const origRes = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const orig = origRes.data;
    const headers = orig.payload?.headers || [];
    const getH = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const origSubject = getH('Subject');
    const origFrom = getH('From');
    const origDate = getH('Date');
    const origTo = getH('To');

    // Extract original body text
    let origBody = '';
    function extractBody(
      part:
        | {
            mimeType?: string | null;
            body?: { data?: string | null } | null;
            parts?: (typeof part)[] | null;
          }
        | null
        | undefined
    ): void {
      if (!part) return;
      if (part.mimeType === 'text/plain' && part.body?.data) {
        origBody = Buffer.from(part.body.data, 'base64url').toString('utf8');
        return;
      }
      for (const sub of part.parts || []) {
        extractBody(sub);
      }
    }
    extractBody(orig.payload);

    const fwdSubject = origSubject.toLowerCase().startsWith('fwd:')
      ? origSubject
      : `Fwd: ${origSubject}`;

    const forwardedBody = [
      additionalBody || '',
      '',
      '---------- Forwarded message ---------',
      `From: ${origFrom}`,
      `Date: ${origDate}`,
      `Subject: ${origSubject}`,
      `To: ${origTo}`,
      '',
      origBody,
    ]
      .join('\n')
      .trim();

    const sendOptions: SendEmailOptions = {
      to,
      subject: fwdSubject,
      body: forwardedBody,
    };

    const raw = composeRawEmail(sendOptions, emailAddress);

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    const sentId = response.data.id || '';
    const sentThreadId = response.data.threadId || '';
    logger.info(`Forwarded message [${messageId}] as [${sentId}] for user [${userId}]`);

    return { success: true, messageId: sentId, threadId: sentThreadId };
  } catch (error: unknown) {
    if (error instanceof ValidationError) throw error;
    logger.error(`Error forwarding message [${messageId}] for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to forward message through Gmail API.');
  }
}
