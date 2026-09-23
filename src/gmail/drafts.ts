import { GmailClientService } from './client.js';
import { GmailApiError, ValidationError } from '../utils/errors.js';
import { composeRawEmail, SendEmailOptions } from './send.js';
import { logger } from '../utils/logger.js';

export interface DraftSummary {
  draftId: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  snippet: string;
}

export interface DraftDetail {
  draftId: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  snippet: string;
  body: string;
}

/**
 * Creates a draft email (not sent).
 */
export async function createDraft(options: SendEmailOptions): Promise<DraftSummary> {
  if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
    throw new ValidationError('At least one recipient in "to" is required.');
  }

  const { gmail, userId, emailAddress } = await GmailClientService.getClient();

  const raw = composeRawEmail(options, emailAddress);

  try {
    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          threadId: options.threadId || undefined,
        },
      },
    });

    const draft = response.data;
    const msg = draft.message;

    logger.info(`Created draft [${draft.id}] for user [${userId}]`);

    return {
      draftId: draft.id || '',
      messageId: msg?.id || '',
      threadId: msg?.threadId || '',
      subject: options.subject || '(No Subject)',
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      snippet: msg?.snippet || '',
    };
  } catch (error: unknown) {
    logger.error(`Error creating draft for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to create Gmail draft.');
  }
}

/**
 * Updates an existing draft with new content.
 */
export async function updateDraft(
  draftId: string,
  options: SendEmailOptions
): Promise<DraftSummary> {
  if (!draftId) {
    throw new ValidationError('Draft ID is required.');
  }

  const { gmail, userId, emailAddress } = await GmailClientService.getClient();

  const raw = composeRawEmail(options, emailAddress);

  try {
    const response = await gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: {
        message: {
          raw,
          threadId: options.threadId || undefined,
        },
      },
    });

    const draft = response.data;
    const msg = draft.message;

    logger.info(`Updated draft [${draftId}] for user [${userId}]`);

    return {
      draftId: draft.id || draftId,
      messageId: msg?.id || '',
      threadId: msg?.threadId || '',
      subject: options.subject || '(No Subject)',
      to: Array.isArray(options.to) ? options.to.join(', ') : (options.to as string),
      snippet: msg?.snippet || '',
    };
  } catch (error: unknown) {
    logger.error(`Error updating draft [${draftId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to update draft "${draftId}".`);
  }
}

/**
 * Permanently deletes a draft.
 */
export async function deleteDraft(draftId: string): Promise<{ success: boolean; draftId: string }> {
  if (!draftId) {
    throw new ValidationError('Draft ID is required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    await gmail.users.drafts.delete({ userId: 'me', id: draftId });
    logger.info(`Deleted draft [${draftId}] for user [${userId}]`);
    return { success: true, draftId };
  } catch (error: unknown) {
    logger.error(`Error deleting draft [${draftId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to delete draft "${draftId}".`);
  }
}

/**
 * Sends an existing draft.
 */
export async function sendDraft(
  draftId: string
): Promise<{ success: boolean; messageId: string; threadId: string }> {
  if (!draftId) {
    throw new ValidationError('Draft ID is required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: { id: draftId },
    });

    const msg = response.data;
    logger.info(`Sent draft [${draftId}] as message [${msg.id}] for user [${userId}]`);

    return {
      success: true,
      messageId: msg.id || '',
      threadId: msg.threadId || '',
    };
  } catch (error: unknown) {
    logger.error(`Error sending draft [${draftId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to send draft "${draftId}".`);
  }
}
