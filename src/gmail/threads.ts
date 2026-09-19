import { GmailClientService } from './client.js';
import { parseMessageSummary, MessageSummary } from './messages.js';
import { GmailApiError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface GmailThreadDetail {
  id: string;
  historyId?: string;
  snippet?: string;
  messagesCount: number;
  messages: MessageSummary[];
}

/**
 * Retrieves a full Gmail thread and all contained messages for the CURRENT user.
 */
export async function getThread(threadId: string): Promise<GmailThreadDetail> {
  if (!threadId || typeof threadId !== 'string') {
    throw new NotFoundError('Invalid or missing thread ID');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Date'],
    });

    const thread = response.data;
    if (!thread || !thread.id) {
      throw new NotFoundError(`Thread with ID "${threadId}" was not found.`);
    }

    const messages = (thread.messages || []).map((msg) => parseMessageSummary(msg));

    logger.info(
      `Retrieved thread [${threadId}] with ${messages.length} messages for user [${userId}]`
    );

    return {
      id: thread.id,
      historyId: thread.historyId || undefined,
      snippet: thread.snippet || (messages[0]?.snippet ?? ''),
      messagesCount: messages.length,
      messages,
    };
  } catch (error: unknown) {
    if (error instanceof NotFoundError) throw error;
    logger.error(`Error getting thread [${threadId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to fetch thread with ID "${threadId}".`);
  }
}
