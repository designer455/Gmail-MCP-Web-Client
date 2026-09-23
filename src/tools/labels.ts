import { z } from 'zod';
import { listLabels, createLabel, updateLabel, deleteLabel, GmailLabel } from '../gmail/labels.js';

// --- Schemas ---
export const listLabelsToolSchema = z.object({});

export const createLabelToolSchema = z.object({
  name: z.string().min(1, 'Label name is required').describe('Name for the new label'),
  labelListVisibility: z
    .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
    .optional()
    .default('labelShow')
    .describe('Visibility in the label list (default: labelShow)'),
  messageListVisibility: z
    .enum(['show', 'hide'])
    .optional()
    .default('show')
    .describe('Visibility in message list (default: show)'),
  textColor: z.string().optional().describe('Label text color hex (e.g. #ffffff)'),
  backgroundColor: z.string().optional().describe('Label background color hex (e.g. #16a765)'),
});

export const updateLabelToolSchema = z.object({
  labelId: z.string().min(1, 'Label ID is required').describe('The label ID to update'),
  name: z.string().optional().describe('New label name'),
  labelListVisibility: z
    .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
    .optional()
    .describe('New label list visibility'),
  messageListVisibility: z
    .enum(['show', 'hide'])
    .optional()
    .describe('New message list visibility'),
  textColor: z.string().optional().describe('New text color hex'),
  backgroundColor: z.string().optional().describe('New background color hex'),
});

export const deleteLabelToolSchema = z.object({
  labelId: z.string().min(1, 'Label ID is required').describe('The label ID to permanently delete'),
});

// --- Types ---
export type ListLabelsToolInput = z.infer<typeof listLabelsToolSchema>;
export type CreateLabelToolInput = z.infer<typeof createLabelToolSchema>;
export type UpdateLabelToolInput = z.infer<typeof updateLabelToolSchema>;
export type DeleteLabelToolInput = z.infer<typeof deleteLabelToolSchema>;

// --- Handlers ---
export async function handleListLabelsTool(): Promise<GmailLabel[]> {
  return listLabels();
}

export async function handleCreateLabelTool(input: CreateLabelToolInput): Promise<GmailLabel> {
  const v = createLabelToolSchema.parse(input);
  return createLabel({
    name: v.name,
    labelListVisibility: v.labelListVisibility,
    messageListVisibility: v.messageListVisibility,
    color:
      v.textColor || v.backgroundColor
        ? { textColor: v.textColor, backgroundColor: v.backgroundColor }
        : undefined,
  });
}

export async function handleUpdateLabelTool(input: UpdateLabelToolInput): Promise<GmailLabel> {
  const v = updateLabelToolSchema.parse(input);
  return updateLabel({
    labelId: v.labelId,
    name: v.name,
    labelListVisibility: v.labelListVisibility,
    messageListVisibility: v.messageListVisibility,
    color:
      v.textColor || v.backgroundColor
        ? { textColor: v.textColor, backgroundColor: v.backgroundColor }
        : undefined,
  });
}

export async function handleDeleteLabelTool(
  input: DeleteLabelToolInput
): Promise<{ success: boolean; labelId: string }> {
  const v = deleteLabelToolSchema.parse(input);
  return deleteLabel(v.labelId);
}
