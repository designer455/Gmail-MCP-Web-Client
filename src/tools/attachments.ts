import { z } from 'zod';
import {
  listAttachments,
  getAttachment,
  searchAttachments,
  AttachmentInfo,
  AttachmentData,
} from '../gmail/attachments.js';
import { ListMessagesResult } from '../gmail/messages.js';

// --- Schemas ---
export const listAttachmentsToolSchema = z.object({
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .describe('The Gmail message ID to list attachments for'),
});

export const getAttachmentToolSchema = z.object({
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .describe('The Gmail message ID containing the attachment'),
  attachmentId: z
    .string()
    .min(1, 'Attachment ID is required')
    .describe('The attachment ID to download'),
});

export const searchAttachmentsToolSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Optional search keyword (e.g. "KreditBee", "loan statement", "EMI invoice") to search alongside attachments'
    ),
  filename: z
    .string()
    .optional()
    .describe(
      'Optional filename or extension to search for (e.g. "statement.pdf", "loan_statement", or ".pdf")'
    ),
  mimeType: z
    .string()
    .optional()
    .describe('Optional MIME type to filter by (e.g. "application/pdf", "image/png")'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of messages to return (default: 20)'),
  pageToken: z.string().optional().describe('Pagination token'),
});

// --- Types ---
export type ListAttachmentsToolInput = z.infer<typeof listAttachmentsToolSchema>;
export type GetAttachmentToolInput = z.infer<typeof getAttachmentToolSchema>;
export type SearchAttachmentsToolInput = z.infer<typeof searchAttachmentsToolSchema>;

// --- Handlers ---
export async function handleListAttachmentsTool(
  input: ListAttachmentsToolInput
): Promise<AttachmentInfo[]> {
  const v = listAttachmentsToolSchema.parse(input);
  return listAttachments(v.messageId);
}

export async function handleGetAttachmentTool(
  input: GetAttachmentToolInput
): Promise<AttachmentData> {
  const v = getAttachmentToolSchema.parse(input);
  return getAttachment(v.messageId, v.attachmentId);
}

export async function handleSearchAttachmentsTool(
  input: SearchAttachmentsToolInput
): Promise<ListMessagesResult> {
  const v = searchAttachmentsToolSchema.parse(input);
  return searchAttachments({
    query: v.query,
    filename: v.filename,
    mimeType: v.mimeType,
    maxResults: v.maxResults,
    pageToken: v.pageToken,
  });
}
