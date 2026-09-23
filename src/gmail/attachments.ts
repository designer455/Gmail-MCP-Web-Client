import { GmailClientService } from './client.js';
import { GmailApiError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { listMessages, ListMessagesResult } from './messages.js';

export interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  messageId: string;
  subject: string;
}

export interface AttachmentData {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  data: string; // base64url encoded
}

/**
 * Lists all attachments in a given message.
 */
export async function listAttachments(messageId: string): Promise<AttachmentInfo[]> {
  if (!messageId) {
    throw new ValidationError('Message ID is required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const msg = response.data;
    const subject =
      msg.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ||
      '(No Subject)';

    const attachments: AttachmentInfo[] = [];

    function traverse(part: {
      filename?: string | null;
      mimeType?: string | null;
      body?: { attachmentId?: string | null; size?: number | null } | null;
      parts?: (typeof part)[] | null;
    }): void {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          messageId,
          subject,
        });
      }
      for (const sub of part.parts || []) {
        traverse(sub);
      }
    }

    if (msg.payload) traverse(msg.payload);

    logger.info(
      `Listed ${attachments.length} attachments in message [${messageId}] for user [${userId}]`
    );
    return attachments;
  } catch (error: unknown) {
    logger.error(
      `Error listing attachments in message [${messageId}] for user [${userId}]: ${error}`
    );
    throw new GmailApiError(`Failed to list attachments for message "${messageId}".`);
  }
}

/**
 * Downloads attachment data as base64url.
 */
export async function getAttachment(
  messageId: string,
  attachmentId: string
): Promise<AttachmentData> {
  if (!messageId || !attachmentId) {
    throw new ValidationError('Message ID and Attachment ID are both required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    // First fetch message to get filename & mimeType
    const msgRes = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    let filename = 'attachment';
    let mimeType = 'application/octet-stream';
    let size = 0;

    function findPart(part: {
      filename?: string | null;
      mimeType?: string | null;
      body?: { attachmentId?: string | null; size?: number | null } | null;
      parts?: (typeof part)[] | null;
    }): boolean {
      if (part.body?.attachmentId === attachmentId) {
        filename = part.filename || 'attachment';
        mimeType = part.mimeType || 'application/octet-stream';
        size = part.body.size || 0;
        return true;
      }
      for (const sub of part.parts || []) {
        if (findPart(sub)) return true;
      }
      return false;
    }

    if (msgRes.data.payload) findPart(msgRes.data.payload);

    // Fetch the actual attachment data
    const attachRes = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    logger.info(
      `Downloaded attachment [${attachmentId}] from message [${messageId}] for user [${userId}]`
    );

    return {
      attachmentId,
      filename,
      mimeType,
      size,
      data: attachRes.data.data || '',
    };
  } catch (error: unknown) {
    logger.error(`Error getting attachment [${attachmentId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to download attachment "${attachmentId}".`);
  }
}

/**
 * Searches messages that have attachments, optionally filtered by keyword, filename, or type.
 */
export async function searchAttachments(options?: {
  query?: string;
  filename?: string;
  mimeType?: string;
  maxResults?: number;
  pageToken?: string;
}): Promise<ListMessagesResult> {
  let q = 'has:attachment';
  if (options?.query) {
    q += ` ${options.query}`;
  }
  if (options?.filename) {
    q += ` filename:${options.filename}`;
  }
  if (options?.mimeType) {
    // Map common mime types to Gmail query terms
    if (options.mimeType.includes('pdf')) q += ' filename:pdf';
    else if (options.mimeType.includes('image'))
      q += ' filename:(jpg OR jpeg OR png OR gif OR webp)';
    else if (options.mimeType.includes('zip')) q += ' filename:(zip OR gz OR tar)';
    else if (options.mimeType.includes('word')) q += ' filename:(doc OR docx)';
    else if (options.mimeType.includes('spreadsheet') || options.mimeType.includes('excel'))
      q += ' filename:(xls OR xlsx OR csv)';
  }

  return listMessages({
    q,
    maxResults: options?.maxResults || 20,
    pageToken: options?.pageToken,
    includeSpamTrash: true,
  });
}
