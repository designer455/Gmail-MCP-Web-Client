import { z } from 'zod';
import { getMessage } from '../gmail/messages.js';
import { getThread } from '../gmail/threads.js';
import { listMessages } from '../gmail/messages.js';

// --- Schemas ---
export const summarizeThreadToolSchema = z.object({
  threadId: z.string().min(1, 'Thread ID is required').describe('The Gmail thread ID to summarize'),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Max messages to include (default: 10)'),
});

export const generateReplyToolSchema = z.object({
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .describe('The Gmail message ID to generate a reply for'),
  tone: z
    .enum(['professional', 'friendly', 'brief'])
    .optional()
    .default('professional')
    .describe('Tone of the generated reply (default: professional)'),
});

export const classifyEmailToolSchema = z.object({
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .describe('The Gmail message ID to classify'),
});

export const extractActionsToolSchema = z.object({
  messageId: z
    .string()
    .min(1, 'Message ID is required')
    .describe('The Gmail message ID to extract action items from'),
});

export const findNewslettersToolSchema = z.object({
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum results to return (default: 20)'),
  pageToken: z.string().optional().describe('Pagination token'),
});

// --- Types ---
export type SummarizeThreadToolInput = z.infer<typeof summarizeThreadToolSchema>;
export type GenerateReplyToolInput = z.infer<typeof generateReplyToolSchema>;
export type ClassifyEmailToolInput = z.infer<typeof classifyEmailToolSchema>;
export type ExtractActionsToolInput = z.infer<typeof extractActionsToolSchema>;
export type FindNewslettersToolInput = z.infer<typeof findNewslettersToolSchema>;

// --- Helper: truncate text ---
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '...' : text;
}

// --- Helper: detect action patterns ---
const ACTION_PATTERNS = [
  /\b(please|kindly)\s+\w+/gi,
  /\b(action required|action item|follow.?up|follow up|next step|to.?do|todo|deadline|due date|asap|urgent)\b/gi,
  /\b(can you|could you|would you|will you|please|make sure to|don't forget to)\b[^.!?\n]{5,80}/gi,
  /\b(by|before|until|no later than)\s+\w+day\b/gi,
  /\b(review|approve|sign|confirm|respond|schedule|book|send|submit|complete|finish|update)\b[^.!?\n]{0,60}/gi,
];

function extractActionItems(text: string): string[] {
  const actions = new Set<string>();
  for (const pattern of ACTION_PATTERNS) {
    const matches = text.match(pattern) || [];
    for (const m of matches) {
      const trimmed = m.trim();
      if (trimmed.length > 5 && trimmed.length < 200) {
        actions.add(trimmed);
      }
    }
  }
  return Array.from(actions).slice(0, 10);
}

// --- Helper: classify by content patterns ---
const NEWSLETTER_PATTERNS = [
  /unsubscribe/i,
  /newsletter/i,
  /mailing.?list/i,
  /list-unsubscribe/i,
  /no-reply@/i,
  /noreply@/i,
  /you('re| are) receiving this/i,
  /view.?in.?browser/i,
  /manage.?preference/i,
  /opt.?out/i,
];

const TRANSACTIONAL_PATTERNS = [
  /order (confirmation|#|number)/i,
  /your (order|receipt|invoice|payment|subscription)/i,
  /transaction|purchase|billing|refund|charge/i,
  /booking (confirmation|#)/i,
  /shipment|tracking|delivered|dispatch/i,
  /verification|confirm your|OTP|one-time/i,
  /account (created|activated|updated)/i,
];

const ACTION_EMAIL_PATTERNS = [
  /action required/i,
  /response needed/i,
  /please (review|confirm|sign|approve)/i,
  /deadline|due (on|by|date)/i,
  /urgent|asap|immediately/i,
];

function classifyByContent(
  subject: string,
  body: string,
  from: string
): { category: string; confidence: string; reason: string } {
  const combined = `${subject} ${body} ${from}`.toLowerCase();

  const newsletterScore = NEWSLETTER_PATTERNS.filter((p) => p.test(combined)).length;
  const transactionalScore = TRANSACTIONAL_PATTERNS.filter((p) => p.test(combined)).length;
  const actionScore = ACTION_EMAIL_PATTERNS.filter((p) => p.test(combined)).length;

  if (newsletterScore >= 2) {
    return {
      category: 'newsletter',
      confidence: newsletterScore >= 3 ? 'high' : 'medium',
      reason: 'Contains newsletter/mailing list indicators',
    };
  }
  if (actionScore >= 2) {
    return {
      category: 'action_required',
      confidence: actionScore >= 3 ? 'high' : 'medium',
      reason: 'Contains urgent action-required language',
    };
  }
  if (transactionalScore >= 2) {
    return {
      category: 'transactional',
      confidence: transactionalScore >= 3 ? 'high' : 'medium',
      reason: 'Contains transactional email indicators (order, receipt, etc.)',
    };
  }
  return {
    category: 'personal',
    confidence: 'medium',
    reason: 'No strong categorical signals detected',
  };
}

// --- Handlers ---

export async function handleSummarizeThreadTool(input: SummarizeThreadToolInput): Promise<{
  threadId: string;
  participantCount: number;
  messageCount: number;
  participants: string[];
  summary: string;
  latestSubject: string;
}> {
  const v = summarizeThreadToolSchema.parse(input);
  const thread = await getThread(v.threadId);

  const messages = thread.messages.slice(0, v.maxMessages);
  const participants = new Set<string>();
  const messageLines: string[] = [];

  for (const msg of messages) {
    if (msg.sender) participants.add(msg.sender);
    messageLines.push(`[${msg.date}] From: ${msg.sender}\nSubject: ${msg.subject}\n${msg.snippet}`);
  }

  const latestMsg = messages[messages.length - 1];
  const participantList = Array.from(participants);

  const summary = [
    `Thread with ${thread.messagesCount} messages between ${participantList.length} participant(s).`,
    `Subject: ${latestMsg?.subject || thread.snippet}`,
    `Last message: ${latestMsg?.date || 'Unknown date'} from ${latestMsg?.sender || 'Unknown'}`,
    `\nMessage snippets:`,
    ...messages.slice(-3).map((m) => `• [${m.sender}] ${truncate(m.snippet, 200)}`),
  ].join('\n');

  return {
    threadId: v.threadId,
    participantCount: participantList.length,
    messageCount: thread.messagesCount,
    participants: participantList,
    summary,
    latestSubject: latestMsg?.subject || thread.snippet || '',
  };
}

export async function handleGenerateReplyTool(input: GenerateReplyToolInput): Promise<{
  messageId: string;
  suggestedReply: string;
  replyToAddress: string;
  subject: string;
}> {
  const v = generateReplyToolSchema.parse(input);
  const msg = await getMessage(v.messageId);

  const toneIntros: Record<string, string> = {
    professional: 'Thank you for your email. ',
    friendly: 'Thanks for reaching out! ',
    brief: '',
  };
  const toneOutros: Record<string, string> = {
    professional: '\n\nPlease let me know if you have any questions.\n\nBest regards,',
    friendly: '\n\nLet me know if you need anything else!\n\nCheers,',
    brief: '\n\nThanks.',
  };

  const intro = toneIntros[v.tone] || toneIntros.professional;
  const outro = toneOutros[v.tone] || toneOutros.professional;

  const bodyPreview = truncate(msg.body.replace(/\s+/g, ' ').trim(), 300);
  const suggestedReply = `${intro}I've reviewed your message regarding "${msg.subject}".\n\n[Your response here - context from original: ${bodyPreview}]${outro}`;

  return {
    messageId: v.messageId,
    suggestedReply,
    replyToAddress: msg.sender,
    subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
  };
}

export async function handleClassifyEmailTool(input: ClassifyEmailToolInput): Promise<{
  messageId: string;
  category: string;
  confidence: string;
  reason: string;
  subject: string;
  from: string;
}> {
  const v = classifyEmailToolSchema.parse(input);
  const msg = await getMessage(v.messageId);

  const result = classifyByContent(msg.subject, msg.body, msg.sender);

  return {
    messageId: v.messageId,
    ...result,
    subject: msg.subject,
    from: msg.sender,
  };
}

export async function handleExtractActionsTool(input: ExtractActionsToolInput): Promise<{
  messageId: string;
  subject: string;
  from: string;
  date: string;
  actionItems: string[];
  hasDeadline: boolean;
  isUrgent: boolean;
}> {
  const v = extractActionsToolSchema.parse(input);
  const msg = await getMessage(v.messageId);

  const fullText = `${msg.subject} ${msg.body}`;
  const actionItems = extractActionItems(fullText);
  const hasDeadline = /\b(by|before|deadline|due|until|no later than)\b/i.test(fullText);
  const isUrgent =
    /\b(urgent|asap|immediately|as soon as possible|critical|time.?sensitive)\b/i.test(fullText);

  return {
    messageId: v.messageId,
    subject: msg.subject,
    from: msg.sender,
    date: msg.date,
    actionItems,
    hasDeadline,
    isUrgent,
  };
}

export async function handleFindNewslettersTool(
  input: FindNewslettersToolInput
): Promise<import('../gmail/messages.js').ListMessagesResult> {
  const v = findNewslettersToolSchema.parse(input);
  // Use Gmail's built-in category and query to find newsletters/subscriptions
  const query = 'category:promotions OR category:updates OR unsubscribe OR list-unsubscribe';
  return listMessages({
    q: query,
    maxResults: v.maxResults,
    pageToken: v.pageToken,
  });
}
