import { z } from 'zod';
import { searchMessages, ListMessagesResult } from '../gmail/messages.js';

export const searchToolSchema = z.object({
  query: z
    .string()
    .min(1, 'Search query is required')
    .describe(
      'Full-content Gmail search query across subject, body, sender, recipient, and attachments. Supports keywords (e.g. "KreditBee", "Navi", "Loan", "EMI"), operators (e.g. "OR", "from:support@kreditbee.in", "has:attachment", "filename:pdf"), and exact phrases in quotes.'
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
  includeSpamTrash: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Whether to include Spam and Trash in the search results (default: true, ensuring lender, statement, and promotional emails are not missed)'
    ),
});

export type SearchToolInput = z.infer<typeof searchToolSchema>;

/**
 * Handler for gmail_search
 */
export async function handleSearchTool(input: SearchToolInput): Promise<ListMessagesResult> {
  const validated = searchToolSchema.parse(input);
  return await searchMessages(
    validated.query,
    validated.maxResults,
    validated.pageToken,
    validated.includeSpamTrash
  );
}
