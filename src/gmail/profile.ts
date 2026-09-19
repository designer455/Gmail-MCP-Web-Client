import { GmailClientService } from './client.js';
import { GmailApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface GmailProfileResult {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId?: string;
}

/**
 * Retrieves the Gmail profile for the CURRENT authenticated user.
 * Always operates on 'me' to ensure account isolation.
 */
export async function getProfile(): Promise<GmailProfileResult> {
  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.getProfile({ userId: 'me' });
    const { emailAddress, messagesTotal, threadsTotal, historyId } = response.data;

    logger.info(`Retrieved Gmail profile for user [${userId}]`);

    return {
      emailAddress: emailAddress || 'unknown',
      messagesTotal: messagesTotal || 0,
      threadsTotal: threadsTotal || 0,
      historyId: historyId || undefined,
    };
  } catch (error: unknown) {
    logger.error(`Error fetching Gmail profile for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to fetch Gmail profile.');
  }
}
