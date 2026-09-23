import { z } from 'zod';
import {
  batchModifyMessages,
  batchArchiveMessages,
  batchMarkReadMessages,
  batchMarkUnreadMessages,
  batchTrashMessages,
  BatchModifyResult,
} from '../gmail/messages.js';
import { getOrCreateLabelByName } from '../gmail/labels.js';

// --- Shared Message IDs Schema ---
const messageIdsSchema = z
  .array(z.string().min(1))
  .min(1, 'At least one message ID is required')
  .describe('Array of Gmail message IDs to operate on');

// --- Schemas ---
export const batchModifyLabelsToolSchema = z.object({
  messageIds: messageIdsSchema,
  addLabelNames: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Array of human-readable label names to apply (e.g. ["Loans", "Bank"]). Will be auto-created if they do not exist.'
    ),
  addLabelIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Array of exact Gmail label IDs to apply (e.g. ["Label_12345", "STARRED"])'),
  removeLabelNames: z
    .array(z.string().min(1))
    .optional()
    .describe('Array of human-readable label names to remove'),
  removeLabelIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Array of exact Gmail label IDs to remove (e.g. ["INBOX", "UNREAD"])'),
});

export const batchArchiveToolSchema = z.object({
  messageIds: messageIdsSchema,
});

export const batchMarkReadToolSchema = z.object({
  messageIds: messageIdsSchema,
});

export const batchMarkUnreadToolSchema = z.object({
  messageIds: messageIdsSchema,
});

export const batchTrashToolSchema = z.object({
  messageIds: messageIdsSchema,
});

// --- Types ---
export type BatchModifyLabelsToolInput = z.infer<typeof batchModifyLabelsToolSchema>;
export type BatchArchiveToolInput = z.infer<typeof batchArchiveToolSchema>;
export type BatchMarkReadToolInput = z.infer<typeof batchMarkReadToolSchema>;
export type BatchMarkUnreadToolInput = z.infer<typeof batchMarkUnreadToolSchema>;
export type BatchTrashToolInput = z.infer<typeof batchTrashToolSchema>;

// --- Handlers ---

/**
 * Handler for gmail_batch_modify_labels
 */
export async function handleBatchModifyLabelsTool(
  input: BatchModifyLabelsToolInput
): Promise<BatchModifyResult> {
  const validated = batchModifyLabelsToolSchema.parse(input);

  // Resolve label names to IDs
  const addIds = [...(validated.addLabelIds || [])];
  if (validated.addLabelNames && validated.addLabelNames.length > 0) {
    const resolvedAdd = await Promise.all(
      validated.addLabelNames.map((name) => getOrCreateLabelByName(name))
    );
    addIds.push(...resolvedAdd);
  }

  const removeIds = [...(validated.removeLabelIds || [])];
  if (validated.removeLabelNames && validated.removeLabelNames.length > 0) {
    const resolvedRemove = await Promise.all(
      validated.removeLabelNames.map((name) => getOrCreateLabelByName(name))
    );
    removeIds.push(...resolvedRemove);
  }

  // Deduplicate IDs
  const uniqueAddIds = Array.from(new Set(addIds));
  const uniqueRemoveIds = Array.from(new Set(removeIds));

  return await batchModifyMessages({
    messageIds: validated.messageIds,
    addLabelIds: uniqueAddIds,
    removeLabelIds: uniqueRemoveIds,
  });
}

/**
 * Handler for gmail_batch_archive
 */
export async function handleBatchArchiveTool(
  input: BatchArchiveToolInput
): Promise<BatchModifyResult> {
  const validated = batchArchiveToolSchema.parse(input);
  return await batchArchiveMessages(validated.messageIds);
}

/**
 * Handler for gmail_batch_mark_read
 */
export async function handleBatchMarkReadTool(
  input: BatchMarkReadToolInput
): Promise<BatchModifyResult> {
  const validated = batchMarkReadToolSchema.parse(input);
  return await batchMarkReadMessages(validated.messageIds);
}

/**
 * Handler for gmail_batch_mark_unread
 */
export async function handleBatchMarkUnreadTool(
  input: BatchMarkUnreadToolInput
): Promise<BatchModifyResult> {
  const validated = batchMarkUnreadToolSchema.parse(input);
  return await batchMarkUnreadMessages(validated.messageIds);
}

/**
 * Handler for gmail_batch_trash
 */
export async function handleBatchTrashTool(input: BatchTrashToolInput): Promise<BatchModifyResult> {
  const validated = batchTrashToolSchema.parse(input);
  return await batchTrashMessages(validated.messageIds);
}
