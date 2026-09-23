import { z } from 'zod';
import { createDraft, updateDraft, deleteDraft, sendDraft, DraftSummary } from '../gmail/drafts.js';

// --- Schemas ---
export const createDraftToolSchema = z.object({
  to: z.union([z.string(), z.array(z.string())]).describe('Recipient email address(es)'),
  cc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('CC recipient(s)'),
  bcc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('BCC recipient(s)'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body (plain text)'),
  threadId: z.string().optional().describe('Thread ID to attach this draft to'),
});

export const updateDraftToolSchema = z.object({
  draftId: z.string().min(1, 'Draft ID is required').describe('The draft ID to update'),
  to: z.union([z.string(), z.array(z.string())]).describe('Recipient email address(es)'),
  cc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('CC recipient(s)'),
  bcc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('BCC recipient(s)'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body (plain text)'),
  threadId: z.string().optional().describe('Thread ID'),
});

export const deleteDraftToolSchema = z.object({
  draftId: z.string().min(1, 'Draft ID is required').describe('The draft ID to permanently delete'),
});

export const sendDraftToolSchema = z.object({
  draftId: z.string().min(1, 'Draft ID is required').describe('The draft ID to send'),
});

// --- Types ---
export type CreateDraftToolInput = z.infer<typeof createDraftToolSchema>;
export type UpdateDraftToolInput = z.infer<typeof updateDraftToolSchema>;
export type DeleteDraftToolInput = z.infer<typeof deleteDraftToolSchema>;
export type SendDraftToolInput = z.infer<typeof sendDraftToolSchema>;

// --- Handlers ---
export async function handleCreateDraftTool(input: CreateDraftToolInput): Promise<DraftSummary> {
  const v = createDraftToolSchema.parse(input);
  return createDraft(v);
}

export async function handleUpdateDraftTool(input: UpdateDraftToolInput): Promise<DraftSummary> {
  const v = updateDraftToolSchema.parse(input);
  const { draftId, ...opts } = v;
  return updateDraft(draftId, opts);
}

export async function handleDeleteDraftTool(
  input: DeleteDraftToolInput
): Promise<{ success: boolean; draftId: string }> {
  const v = deleteDraftToolSchema.parse(input);
  return deleteDraft(v.draftId);
}

export async function handleSendDraftTool(
  input: SendDraftToolInput
): Promise<{ success: boolean; messageId: string; threadId: string }> {
  const v = sendDraftToolSchema.parse(input);
  return sendDraft(v.draftId);
}
