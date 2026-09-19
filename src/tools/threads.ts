import { z } from 'zod';
import { getThread, GmailThreadDetail } from '../gmail/threads.js';

export const getThreadToolSchema = z.object({
  threadId: z
    .string()
    .min(1, 'Thread ID is required')
    .describe('The unique ID of the thread to retrieve'),
});

export type GetThreadToolInput = z.infer<typeof getThreadToolSchema>;

/**
 * Handler for gmail_get_thread
 */
export async function handleGetThreadTool(input: GetThreadToolInput): Promise<GmailThreadDetail> {
  const validated = getThreadToolSchema.parse(input);
  return await getThread(validated.threadId);
}
