import { z } from 'zod';
import { searchMessages, ListMessagesResult } from '../gmail/messages.js';

export const searchToolSchema = z.object({
  query: z
    .string()
    .min(1, 'Search query is required')
    .describe(
      'Gmail search syntax query (e.g. "from:john@example.com", "subject:invoice", "is:unread")'
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of results to return (1-100, default: 20)'),
  pageToken: z.string().optional().describe('Pagination token for next page of search results'),
});

export type SearchToolInput = z.infer<typeof searchToolSchema>;

/**
 * Handler for gmail_search
 */
export async function handleSearchTool(input: SearchToolInput): Promise<ListMessagesResult> {
  const validated = searchToolSchema.parse(input);
  return await searchMessages(validated.query, validated.maxResults, validated.pageToken);
}
