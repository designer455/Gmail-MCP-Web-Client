import { GmailClientService } from './client.js';
import { GmailApiError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface LabelColor {
  textColor?: string;
  backgroundColor?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: LabelColor;
}

export interface CreateLabelOptions {
  name: string;
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  messageListVisibility?: 'show' | 'hide';
  color?: LabelColor;
}

export interface UpdateLabelOptions {
  labelId: string;
  name?: string;
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  messageListVisibility?: 'show' | 'hide';
  color?: LabelColor;
}

/**
 * System label IDs recognized by Gmail API
 */
const SYSTEM_LABELS: Record<string, string> = {
  INBOX: 'INBOX',
  SPAM: 'SPAM',
  TRASH: 'TRASH',
  UNREAD: 'UNREAD',
  STARRED: 'STARRED',
  IMPORTANT: 'IMPORTANT',
  SENT: 'SENT',
  DRAFT: 'DRAFT',
  CHAT: 'CHAT',
};

/**
 * Lists all labels in the authenticated user's mailbox.
 */
export async function listLabels(): Promise<GmailLabel[]> {
  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.labels.list({ userId: 'me' });
    const rawLabels = response.data.labels || [];

    const labels: GmailLabel[] = [];
    const chunkSize = 10;
    for (let i = 0; i < rawLabels.length; i += chunkSize) {
      const chunk = rawLabels.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (raw) => {
          if (!raw.id) return null;
          try {
            const detail = await gmail.users.labels.get({ userId: 'me', id: raw.id });
            const d = detail.data;
            return {
              id: d.id || '',
              name: d.name || '',
              type: d.type || 'user',
              messagesTotal: d.messagesTotal || undefined,
              messagesUnread: d.messagesUnread || undefined,
              threadsTotal: d.threadsTotal || undefined,
              threadsUnread: d.threadsUnread || undefined,
              color: d.color
                ? {
                    textColor: d.color.textColor || undefined,
                    backgroundColor: d.color.backgroundColor || undefined,
                  }
                : undefined,
            } as GmailLabel;
          } catch {
            return { id: raw.id, name: raw.name || '', type: raw.type || 'user' } as GmailLabel;
          }
        })
      );
      for (const res of chunkResults) {
        if (res) labels.push(res);
      }
    }

    logger.info(`Retrieved ${labels.length} labels for user [${userId}]`);
    return labels;
  } catch (error: unknown) {
    logger.error(`Error listing labels for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to list Gmail labels.');
  }
}

/**
 * Resolves a label name or ID to an existing label ID, creating the label if it does not exist.
 */
export async function getOrCreateLabelByName(nameOrId: string): Promise<string> {
  const trimmed = nameOrId.trim();
  if (!trimmed) {
    throw new ValidationError('Label name or ID is required.');
  }

  const upper = trimmed.toUpperCase();
  if (SYSTEM_LABELS[upper]) {
    return SYSTEM_LABELS[upper];
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const listRes = await gmail.users.labels.list({ userId: 'me' });
    const existing = listRes.data.labels || [];
    const found = existing.find(
      (l) =>
        l.name?.toLowerCase() === trimmed.toLowerCase() ||
        l.id?.toLowerCase() === trimmed.toLowerCase()
    );

    if (found?.id) {
      return found.id;
    }

    // Auto-create user label if not found
    const createRes = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: trimmed,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });

    if (!createRes.data.id) {
      throw new GmailApiError(`Failed to create label "${trimmed}".`);
    }

    logger.info(`Auto-created label [${trimmed}] (ID: ${createRes.data.id}) for user [${userId}]`);
    return createRes.data.id;
  } catch (error: unknown) {
    if (error instanceof ValidationError || error instanceof GmailApiError) throw error;
    logger.error(`Error finding or creating label [${trimmed}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to resolve label "${trimmed}".`);
  }
}

/**
 * Creates a new label in the authenticated user's mailbox.
 */
export async function createLabel(options: CreateLabelOptions): Promise<GmailLabel> {
  if (!options.name || options.name.trim() === '') {
    throw new ValidationError('Label name is required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: options.name.trim(),
        labelListVisibility: options.labelListVisibility || 'labelShow',
        messageListVisibility: options.messageListVisibility || 'show',
        color: options.color,
      },
    });

    const label = response.data;
    logger.info(`Created label [${label.name}] for user [${userId}]`);

    return {
      id: label.id || '',
      name: label.name || '',
      type: label.type || 'user',
      color: label.color
        ? {
            textColor: label.color.textColor || undefined,
            backgroundColor: label.color.backgroundColor || undefined,
          }
        : undefined,
    };
  } catch (error: unknown) {
    logger.error(`Error creating label for user [${userId}]: ${error}`);
    throw new GmailApiError('Failed to create Gmail label.');
  }
}

/**
 * Updates an existing label's name, visibility, or color.
 */
export async function updateLabel(options: UpdateLabelOptions): Promise<GmailLabel> {
  if (!options.labelId) {
    throw new ValidationError('Label ID is required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    const response = await gmail.users.labels.update({
      userId: 'me',
      id: options.labelId,
      requestBody: {
        id: options.labelId,
        name: options.name,
        labelListVisibility: options.labelListVisibility,
        messageListVisibility: options.messageListVisibility,
        color: options.color,
      },
    });

    const label = response.data;
    logger.info(`Updated label [${options.labelId}] for user [${userId}]`);

    return {
      id: label.id || '',
      name: label.name || '',
      type: label.type || 'user',
      color: label.color
        ? {
            textColor: label.color.textColor || undefined,
            backgroundColor: label.color.backgroundColor || undefined,
          }
        : undefined,
    };
  } catch (error: unknown) {
    logger.error(`Error updating label [${options.labelId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to update label "${options.labelId}".`);
  }
}

/**
 * Permanently deletes a user-created label. System labels cannot be deleted.
 */
export async function deleteLabel(labelId: string): Promise<{ success: boolean; labelId: string }> {
  if (!labelId) {
    throw new ValidationError('Label ID is required.');
  }

  const { gmail, userId } = await GmailClientService.getClient();

  try {
    await gmail.users.labels.delete({ userId: 'me', id: labelId });
    logger.info(`Deleted label [${labelId}] for user [${userId}]`);
    return { success: true, labelId };
  } catch (error: unknown) {
    logger.error(`Error deleting label [${labelId}] for user [${userId}]: ${error}`);
    throw new GmailApiError(`Failed to delete label "${labelId}".`);
  }
}
