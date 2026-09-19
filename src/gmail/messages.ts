import { gmail_v1 } from 'googleapis';
import { GmailClientService } from './client.js';
import { GmailApiError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface MessageSummary {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  recipients: string;
  date: string;
  snippet: string;
}

export interface AttachmentMetadata {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface FullMessageDetail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  recipients: string;
  date: string;
  snippet: string;
  headers: Record<string, string>;
  body: string;
  attachments: AttachmentMetadata[];
}

export interface ListMessagesResult {
  messages: MessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * Extracts a specific header value by name from Gmail headers array
 */
function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value || '';
}

/**
 * Recursively decodes email body from message payload parts
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Single-part body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }

  // Multi-part body
  if (payload.parts && payload.parts.length > 0) {
    // Prefer text/plain if available
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
    if (plainPart?.body?.data) {
      return Buffer.from(plainPart.body.data, 'base64url').toString('utf8');
    }

    // Otherwise text/html
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, 'base64url').toString('utf8');
    }

    // Recursively check nested parts
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return '';
}

/**
 * Extracts attachment metadata without persisting files
 */
function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): AttachmentMetadata[] {
  const attachments: AttachmentMetadata[] = [];
  if (!payload) return attachments;

  function traverse(part: gmail_v1.Schema$MessagePart) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      });
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        traverse(subPart);
      }
    }
  }

  traverse(payload);
  return attachments;
}

/**
 * Parses a Gmail API message into a concise summary
 */
export function parseMessageSummary(msg: gmail_v1.Schema$Message): MessageSummary {
  const headers = msg.payload?.headers || [];
  return {
    messageId: msg.id || '',
    threadId: msg.threadId || '',
    subject: getHeader(headers, 'Subject') || '(No Subject)',
    sender: getHeader(headers, 'From') || 'Unknown',
    recipients: getHeader(headers, 'To') || '',
    date: getHeader(headers, 'Date') || '',
    snippet: msg.snippet || '',
  };
}

/**
 * Lists messages in the CURRENT user's mailbox with optional filters
 */
export async function listMessages(options?: {
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  q?: string;
}): Promise<ListMessagesResult> {
  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: options?.maxResults || 20,
      pageToken: options?.pageToken || undefined,
      labelIds: options?.labelIds || undefined,
      q: options?.q || undefined,
    });

    const rawList = listRes.data.messages || [];
    const nextPageToken = listRes.data.nextPageToken || undefined;
    const resultSizeEstimate = listRes.data.resultSizeEstimate || undefined;

    // Fetch message summaries in batches (up to 20 for performance)
    const summaries: MessageSummary[] = [];
    for (const item of rawList.slice(0, options?.maxResults || 20)) {
      if (!item.id) continue;
      try {
        const detailRes = await gmail.users.messages.get({
          userId: 'me',
          id: item.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        summaries.push(parseMessageSummary(detailRes.data));
      } catch (e) {
        logger.debug(`Could not fetch metadata for message ${item.id}: ${e}`);
        summaries.push({
          messageId: item.id,
          threadId: item.threadId || '',
          subject: '(Metadata unavailable)',
          sender: '',
          recipients: '',
          date: '',
          snippet: '',
        });
      }
    }

    logger.info(`Retrieved ${summaries.length} messages for user [${userId}]`);

    return {
      messages: summaries,
      nextPageToken,
      resultSizeEstimate,
    };
  } catch (error: unknown) {
    logger.error(`Error listing messages for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to list messages from Gmail.');
  }
}

/**
 * Searches messages using Gmail query syntax (from:, subject:, is:unread, etc.)
 */
export async function searchMessages(
  query: string,
  maxResults = 20,
  pageToken?: string
): Promise<ListMessagesResult> {
  return listMessages({
    q: query,
    maxResults,
    pageToken,
  });
}

/**
 * Retrieves full details of a specific message by ID from the CURRENT user's mailbox
 */
export async function getMessage(messageId: string): Promise<FullMessageDetail> {
  if (!messageId || typeof messageId !== 'string') {
    throw new NotFoundError('Invalid or missing message ID');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const msg = response.data;
    if (!msg || !msg.id) {
      throw new NotFoundError(`Message with ID "${messageId}" was not found.`);
    }

    const headersArray = msg.payload?.headers || [];
    const headerMap: Record<string, string> = {};
    for (const h of headersArray) {
      if (h.name && h.value) {
        headerMap[h.name.toLowerCase()] = h.value;
      }
    }

    const body = extractBody(msg.payload);
    const attachments = extractAttachments(msg.payload);

    logger.info(`Retrieved full message [${messageId}] for user [${userId}]`);

    return {
      id: msg.id,
      threadId: msg.threadId || '',
      subject: headerMap['subject'] || '(No Subject)',
      sender: headerMap['from'] || 'Unknown',
      recipients: headerMap['to'] || '',
      date: headerMap['date'] || '',
      snippet: msg.snippet || '',
      headers: headerMap,
      body,
      attachments,
    };
  } catch (error: unknown) {
    if (error instanceof NotFoundError) throw error;
    logger.error(`Error getting message [${messageId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to fetch message with ID "${messageId}".`);
  }
}
