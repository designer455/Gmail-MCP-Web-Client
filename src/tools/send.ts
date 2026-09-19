import { z } from 'zod';
import { sendEmail, SendEmailResult } from '../gmail/send.js';

export const sendToolSchema = z.object({
  to: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .describe('Primary recipient email address or array of recipient email addresses'),
  cc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Optional CC recipient email address or list of addresses'),
  bcc: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Optional BCC recipient email address or list of addresses'),
  subject: z.string().min(1, 'Email subject is required').describe('Email subject line'),
  body: z
    .string()
    .min(1, 'Email body is required')
    .describe('Plain text body content of the email'),
  threadId: z
    .string()
    .optional()
    .describe('Optional thread ID to reply inside an existing conversation thread'),
  inReplyTo: z
    .string()
    .optional()
    .describe('Optional Message-ID header value that this email is replying to'),
});

export type SendToolInput = z.infer<typeof sendToolSchema>;

/**
 * Handler for gmail_send
 * Disallows client-specified user_id or account IDs.
 * Always sends from the authenticated session context.
 */
export async function handleSendTool(input: SendToolInput): Promise<SendEmailResult> {
  const validated = sendToolSchema.parse(input);
  return await sendEmail({
    to: validated.to,
    cc: validated.cc,
    bcc: validated.bcc,
    subject: validated.subject,
    body: validated.body,
    threadId: validated.threadId,
    inReplyTo: validated.inReplyTo,
  });
}
