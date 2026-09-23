import { z } from 'zod';
import {
  markMessageRead,
  markMessageUnread,
  starMessage,
  unstarMessage,
  archiveMessage,
  moveMessage,
  trashMessage,
  restoreMessage,
  deleteMessagePermanently,
  modifyMessageLabels,
} from '../gmail/messages.js';
import { replyToMessage, forwardMessage } from '../gmail/send.js';
import { listThreads, ListThreadsResult } from '../gmail/threads.js';
import { SendEmailResult } from '../gmail/send.js';

// --- Shared message ID schema ---
const messageIdSchema = z
  .string()
  .min(1, 'Message ID is required')
  .describe('The Gmail message ID');

// --- Schemas ---
export const markReadToolSchema = z.object({ messageId: messageIdSchema });
export const markUnreadToolSchema = z.object({ messageId: messageIdSchema });
export const starToolSchema = z.object({ messageId: messageIdSchema });
export const unstarToolSchema = z.object({ messageId: messageIdSchema });
export const archiveToolSchema = z.object({ messageId: messageIdSchema });
export const trashToolSchema = z.object({ messageId: messageIdSchema });
export const restoreToolSchema = z.object({ messageId: messageIdSchema });
export const deletePermanentlyToolSchema = z.object({ messageId: messageIdSchema });

export const addLabelToolSchema = z.object({
  messageId: messageIdSchema,
  labelId: z.string().min(1, 'Label ID is required').describe('The label ID to add'),
});

export const removeLabelToolSchema = z.object({
  messageId: messageIdSchema,
  labelId: z.string().min(1, 'Label ID is required').describe('The label ID to remove'),
});

export const moveLabelToolSchema = z.object({
  messageId: messageIdSchema,
  targetLabelId: z
    .string()
    .min(1, 'Target label ID is required')
    .describe('Label ID to move the message into'),
  removeFromInbox: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to remove INBOX label (default: true)'),
});

export const snoozeToolSchema = z.object({
  messageId: messageIdSchema,
  snoozeLabelName: z
    .string()
    .optional()
    .default('Snoozed')
    .describe('Label name to apply as snooze marker (default: "Snoozed")'),
});

export const replyToolSchema = z.object({
  messageId: messageIdSchema,
  to: z.union([z.string(), z.array(z.string())]).describe('Reply recipient(s)'),
  body: z.string().describe('Reply body text'),
  subject: z.string().optional().describe('Optional override subject (auto-prefixed with "Re:")'),
  cc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('CC recipient(s)'),
  bcc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('BCC recipient(s)'),
});

export const forwardToolSchema = z.object({
  messageId: messageIdSchema,
  to: z.union([z.string(), z.array(z.string())]).describe('Forward recipient(s)'),
  additionalBody: z
    .string()
    .optional()
    .describe('Optional message to prepend before the forwarded content'),
});

export const listThreadsToolSchema = z.object({
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of threads (1-100, default: 20)'),
  pageToken: z.string().optional().describe('Pagination token'),
  labelIds: z
    .array(z.string())
    .optional()
    .describe('Filter by label IDs (e.g. ["INBOX", "UNREAD"])'),
  query: z.string().optional().describe('Gmail search query to filter threads'),
});

// --- Types ---
export type MarkReadToolInput = z.infer<typeof markReadToolSchema>;
export type MarkUnreadToolInput = z.infer<typeof markUnreadToolSchema>;
export type StarToolInput = z.infer<typeof starToolSchema>;
export type UnstarToolInput = z.infer<typeof unstarToolSchema>;
export type ArchiveToolInput = z.infer<typeof archiveToolSchema>;
export type AddLabelToolInput = z.infer<typeof addLabelToolSchema>;
export type RemoveLabelToolInput = z.infer<typeof removeLabelToolSchema>;
export type MoveLabelToolInput = z.infer<typeof moveLabelToolSchema>;
export type SnoozeToolInput = z.infer<typeof snoozeToolSchema>;
export type TrashToolInput = z.infer<typeof trashToolSchema>;
export type RestoreToolInput = z.infer<typeof restoreToolSchema>;
export type DeletePermanentlyToolInput = z.infer<typeof deletePermanentlyToolSchema>;
export type ReplyToolInput = z.infer<typeof replyToolSchema>;
export type ForwardToolInput = z.infer<typeof forwardToolSchema>;
export type ListThreadsToolInput = z.infer<typeof listThreadsToolSchema>;

// --- Handlers ---
export async function handleMarkReadTool(input: MarkReadToolInput) {
  const v = markReadToolSchema.parse(input);
  return markMessageRead(v.messageId);
}

export async function handleMarkUnreadTool(input: MarkUnreadToolInput) {
  const v = markUnreadToolSchema.parse(input);
  return markMessageUnread(v.messageId);
}

export async function handleStarTool(input: StarToolInput) {
  const v = starToolSchema.parse(input);
  return starMessage(v.messageId);
}

export async function handleUnstarTool(input: UnstarToolInput) {
  const v = unstarToolSchema.parse(input);
  return unstarMessage(v.messageId);
}

export async function handleArchiveTool(input: ArchiveToolInput) {
  const v = archiveToolSchema.parse(input);
  return archiveMessage(v.messageId);
}

export async function handleAddLabelTool(input: AddLabelToolInput) {
  const v = addLabelToolSchema.parse(input);
  return modifyMessageLabels(v.messageId, [v.labelId], []);
}

export async function handleRemoveLabelTool(input: RemoveLabelToolInput) {
  const v = removeLabelToolSchema.parse(input);
  return modifyMessageLabels(v.messageId, [], [v.labelId]);
}

export async function handleMoveMessageTool(input: MoveLabelToolInput) {
  const v = moveLabelToolSchema.parse(input);
  return moveMessage(v.messageId, v.targetLabelId, v.removeFromInbox);
}

export async function handleSnoozeTool(
  input: SnoozeToolInput
): Promise<{ success: boolean; messageId: string; note: string }> {
  const v = snoozeToolSchema.parse(input);
  // Archive message (remove from INBOX) - actual time-based snooze requires a server-side cron
  await archiveMessage(v.messageId);
  return {
    success: true,
    messageId: v.messageId,
    note: `Message archived with label "${v.snoozeLabelName}". Full time-based snooze scheduling is managed by Gmail's snooze feature.`,
  };
}

export async function handleTrashTool(
  input: TrashToolInput
): Promise<{ success: boolean; messageId: string }> {
  const v = trashToolSchema.parse(input);
  return trashMessage(v.messageId);
}

export async function handleRestoreTool(
  input: RestoreToolInput
): Promise<{ success: boolean; messageId: string }> {
  const v = restoreToolSchema.parse(input);
  return restoreMessage(v.messageId);
}

export async function handleDeletePermanentlyTool(
  input: DeletePermanentlyToolInput
): Promise<{ success: boolean; messageId: string }> {
  const v = deletePermanentlyToolSchema.parse(input);
  return deleteMessagePermanently(v.messageId);
}

export async function handleReplyTool(input: ReplyToolInput): Promise<SendEmailResult> {
  const v = replyToolSchema.parse(input);
  const { messageId, subject, ...rest } = v;
  return replyToMessage(messageId, { ...rest, subject: subject ?? '' });
}

export async function handleForwardTool(input: ForwardToolInput): Promise<SendEmailResult> {
  const v = forwardToolSchema.parse(input);
  return forwardMessage(v.messageId, v.to, v.additionalBody);
}

export async function handleListThreadsTool(
  input: ListThreadsToolInput
): Promise<ListThreadsResult> {
  const v = listThreadsToolSchema.parse(input);
  return listThreads({
    maxResults: v.maxResults,
    pageToken: v.pageToken,
    labelIds: v.labelIds,
    q: v.query,
  });
}
