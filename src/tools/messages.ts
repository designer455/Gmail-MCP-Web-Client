import { z } from 'zod';
import {
  listMessages,
  getMessage,
  ListMessagesResult,
  FullMessageDetail,
} from '../gmail/messages.js';

export const listMessagesToolSchema = z.object({
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of messages to return (1-100, default: 20)'),
  pageToken: z.string().optional().describe('Page token to retrieve specific page of results'),
  labelIds: z
    .array(z.string())
    .optional()
    .describe('List of label IDs to filter messages by (e.g. ["INBOX", "UNREAD", "STARRED"])'),
  query: z.string().optional().describe('Optional query string to filter messages'),
});

export const getMessageToolSchema = z.object({
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .describe('The unique ID of the message to retrieve'),
});

export type ListMessagesToolInput = z.infer<typeof listMessagesToolSchema>;
export type GetMessageToolInput = z.infer<typeof getMessageToolSchema>;

/**
 * Handler for gmail_list_messages
 */
export async function handleListMessagesTool(
  input: ListMessagesToolInput
): Promise<ListMessagesResult> {
  const validated = listMessagesToolSchema.parse(input);
  return await listMessages({
    maxResults: validated.maxResults,
    pageToken: validated.pageToken,
    labelIds: validated.labelIds,
    q: validated.query,
  });
}

/**
 * Handler for gmail_get_message
 */
export async function handleGetMessageTool(input: GetMessageToolInput): Promise<FullMessageDetail> {
  const validated = getMessageToolSchema.parse(input);
  return await getMessage(validated.messageId);
}
