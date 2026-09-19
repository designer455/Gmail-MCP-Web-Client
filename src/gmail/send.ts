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
