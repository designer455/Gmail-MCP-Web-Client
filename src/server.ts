import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { handleStatusTool } from './tools/status.js';
import { handleProfileTool } from './tools/profile.js';
import { handleSearchTool, SearchToolInput } from './tools/search.js';
import {
  handleListMessagesTool,
  handleGetMessageTool,
  ListMessagesToolInput,
  GetMessageToolInput,
} from './tools/messages.js';
import { handleGetThreadTool, GetThreadToolInput } from './tools/threads.js';
import { handleSendTool, SendToolInput } from './tools/send.js';
import {
  handleListLabelsTool,
  handleCreateLabelTool,
  handleUpdateLabelTool,
  handleDeleteLabelTool,
  CreateLabelToolInput,
  UpdateLabelToolInput,
  DeleteLabelToolInput,
} from './tools/labels.js';
import {
  handleCreateDraftTool,
  handleUpdateDraftTool,
  handleDeleteDraftTool,
  handleSendDraftTool,
  CreateDraftToolInput,
  UpdateDraftToolInput,
  DeleteDraftToolInput,
  SendDraftToolInput,
} from './tools/drafts.js';
import {
  handleMarkReadTool,
  handleMarkUnreadTool,
  handleStarTool,
  handleUnstarTool,
  handleArchiveTool,
  handleAddLabelTool,
  handleRemoveLabelTool,
  handleMoveMessageTool,
  handleSnoozeTool,
  handleTrashTool,
  handleRestoreTool,
  handleDeletePermanentlyTool,
  handleReplyTool,
  handleForwardTool,
  handleListThreadsTool,
  MarkReadToolInput,
  MarkUnreadToolInput,
  StarToolInput,
  UnstarToolInput,
  ArchiveToolInput,
  AddLabelToolInput,
  RemoveLabelToolInput,
  MoveLabelToolInput,
  SnoozeToolInput,
  TrashToolInput,
  RestoreToolInput,
  DeletePermanentlyToolInput,
  ReplyToolInput,
  ForwardToolInput,
  ListThreadsToolInput,
} from './tools/organize.js';
import {
  handleListAttachmentsTool,
  handleGetAttachmentTool,
  handleSearchAttachmentsTool,
  ListAttachmentsToolInput,
  GetAttachmentToolInput,
  SearchAttachmentsToolInput,
} from './tools/attachments.js';
import {
  handleSummarizeThreadTool,
  handleGenerateReplyTool,
  handleClassifyEmailTool,
  handleExtractActionsTool,
  handleFindNewslettersTool,
  SummarizeThreadToolInput,
  GenerateReplyToolInput,
  ClassifyEmailToolInput,
  ExtractActionsToolInput,
  FindNewslettersToolInput,
} from './tools/smart.js';
import { sanitizeErrorMessage, GmailNotConnectedError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { getCurrentUser } from './auth/session.js';
import { createGoogleLinkToken } from './auth/link-token.js';

export const GMAIL_TOOLS: Tool[] = [
  // ── STATUS ──────────────────────────────────────────────────────────────────
  {
    name: 'gmail_mcp_status',
    description:
      'Check Gmail MCP server configuration status, authentication health, and TokenStore mode. Returns safe diagnostic info without secrets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'gmail_get_profile',
    description:
      'Retrieve Gmail profile metadata (email address, total messages count, total threads count) for the currently authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },

  // ── READ ─────────────────────────────────────────────────────────────────────
  {
    name: 'gmail_search',
    description:
      'Search the authenticated user\'s Gmail mailbox using standard Gmail query syntax (e.g. "from:alice@example.com", "subject:invoice", "is:unread").',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query syntax' },
        maxResults: {
          type: 'number',
          description: 'Maximum number of messages to return (1-100, default: 20)',
          default: 20,
        },
        pageToken: {
          type: 'string',
          description: 'Optional pagination token from previous search',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_list_messages',
    description:
      "List messages from the authenticated user's Gmail inbox with optional label, query, and pagination filtering.",
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum number of messages to list (1-100, default: 20)',
          default: 20,
        },
        pageToken: { type: 'string', description: 'Optional pagination token' },
        labelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional label IDs to filter (e.g. ["INBOX", "UNREAD"])',
        },
        query: { type: 'string', description: 'Optional search query to filter messages' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_get_message',
    description:
      'Retrieve full details of a specific email message including sender, recipients, subject, date, headers, decoded body, and attachment metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The unique Gmail message ID' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_list_threads',
    description:
      "List conversation threads in the authenticated user's Gmail mailbox with optional filters.",
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum number of threads (1-100, default: 20)',
          default: 20,
        },
        pageToken: { type: 'string', description: 'Pagination token' },
        labelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by label IDs (e.g. ["INBOX", "UNREAD"])',
        },
        query: { type: 'string', description: 'Gmail search query to filter threads' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_get_thread',
    description: 'Retrieve an entire conversation thread and all messages within it by thread ID.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The unique Gmail thread ID' },
      },
      required: ['threadId'],
      additionalProperties: false,
    },
  },

  // ── SEND ─────────────────────────────────────────────────────────────────────
  {
    name: 'gmail_send',
    description: "Send a new email from the currently authenticated user's Gmail account.",
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Recipient email address(es)',
        },
        cc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Optional CC address(es)',
        },
        bcc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Optional BCC address(es)',
        },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (plain text)' },
        threadId: {
          type: 'string',
          description: 'Optional thread ID to reply to an existing thread',
        },
        inReplyTo: {
          type: 'string',
          description: 'Optional Message-ID header this message is in reply to',
        },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_reply',
    description:
      'Reply to an existing email message. Automatically sets thread ID, In-Reply-To, References, and "Re:" subject prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The message ID to reply to' },
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Reply recipient(s)',
        },
        body: { type: 'string', description: 'Reply body text' },
        subject: {
          type: 'string',
          description: 'Optional subject override (auto-prefixed with "Re:")',
        },
        cc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'CC recipient(s)',
        },
        bcc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'BCC recipient(s)',
        },
      },
      required: ['messageId', 'to', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_forward',
    description: 'Forward an email message to new recipients, quoting the original content.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The message ID to forward' },
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Forward recipient(s)',
        },
        additionalBody: {
          type: 'string',
          description: 'Optional message to prepend before the forwarded content',
        },
      },
      required: ['messageId', 'to'],
      additionalProperties: false,
    },
  },

  // ── DRAFTS ───────────────────────────────────────────────────────────────────
  {
    name: 'gmail_create_draft',
    description: 'Create a draft email without sending it.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Recipient email address(es)',
        },
        cc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'CC recipient(s)',
        },
        bcc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'BCC recipient(s)',
        },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        threadId: { type: 'string', description: 'Thread ID to attach this draft to' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_update_draft',
    description: 'Update the content of an existing draft email.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string', description: 'The draft ID to update' },
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Recipient email address(es)',
        },
        cc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'CC recipient(s)',
        },
        bcc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'BCC recipient(s)',
        },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        threadId: { type: 'string', description: 'Thread ID' },
      },
      required: ['draftId', 'to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_delete_draft',
    description: 'Permanently delete a draft email.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string', description: 'The draft ID to delete' },
      },
      required: ['draftId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_send_draft',
    description: 'Send an existing draft email.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: { type: 'string', description: 'The draft ID to send' },
      },
      required: ['draftId'],
      additionalProperties: false,
    },
  },

  // ── LABELS ───────────────────────────────────────────────────────────────────
  {
    name: 'gmail_list_labels',
    description:
      "List all labels (folders) in the authenticated user's Gmail account, including system and user-created labels.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'gmail_create_label',
    description: "Create a new label (folder) in the authenticated user's Gmail account.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new label' },
        labelListVisibility: {
          type: 'string',
          enum: ['labelShow', 'labelShowIfUnread', 'labelHide'],
          description: 'Visibility in the label list',
        },
        messageListVisibility: {
          type: 'string',
          enum: ['show', 'hide'],
          description: 'Visibility in message list',
        },
        textColor: { type: 'string', description: 'Label text color hex (e.g. #ffffff)' },
        backgroundColor: {
          type: 'string',
          description: 'Label background color hex (e.g. #16a765)',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_update_label',
    description: "Update an existing label's name, color, or visibility settings.",
    inputSchema: {
      type: 'object',
      properties: {
        labelId: { type: 'string', description: 'The label ID to update' },
        name: { type: 'string', description: 'New label name' },
        labelListVisibility: {
          type: 'string',
          enum: ['labelShow', 'labelShowIfUnread', 'labelHide'],
          description: 'New label list visibility',
        },
        messageListVisibility: {
          type: 'string',
          enum: ['show', 'hide'],
          description: 'New message list visibility',
        },
        textColor: { type: 'string', description: 'New text color hex' },
        backgroundColor: { type: 'string', description: 'New background color hex' },
      },
      required: ['labelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_delete_label',
    description:
      'Permanently delete a user-created label. System labels (INBOX, SENT, etc.) cannot be deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        labelId: { type: 'string', description: 'The label ID to permanently delete' },
      },
      required: ['labelId'],
      additionalProperties: false,
    },
  },

  // ── ORGANIZE ─────────────────────────────────────────────────────────────────
  {
    name: 'gmail_add_label',
    description: 'Add a label to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
        labelId: { type: 'string', description: 'The label ID to add' },
      },
      required: ['messageId', 'labelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_remove_label',
    description: 'Remove a label from a message.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
        labelId: { type: 'string', description: 'The label ID to remove' },
      },
      required: ['messageId', 'labelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_move_message',
    description: 'Move a message to a different label/folder.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
        targetLabelId: { type: 'string', description: 'Label ID to move the message into' },
        removeFromInbox: {
          type: 'boolean',
          description: 'Whether to remove INBOX label (default: true)',
          default: true,
        },
      },
      required: ['messageId', 'targetLabelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_archive',
    description: 'Archive a message by removing it from the INBOX label.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to archive' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },

  // ── STATUS MANAGEMENT ────────────────────────────────────────────────────────
  {
    name: 'gmail_mark_read',
    description: 'Mark an email message as read (removes the UNREAD label).',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_mark_unread',
    description: 'Mark an email message as unread (adds the UNREAD label).',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_star',
    description: 'Star an email message (adds the STARRED label).',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_unstar',
    description: 'Remove star from an email message (removes the STARRED label).',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_snooze',
    description:
      'Snooze/archive a message out of the inbox. Archives the message (removes from INBOX). Note: full time-based snooze is managed by Gmail.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to snooze' },
        snoozeLabelName: {
          type: 'string',
          description: 'Label name to apply as snooze marker (default: "Snoozed")',
          default: 'Snoozed',
        },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },

  // ── DELETE ───────────────────────────────────────────────────────────────────
  {
    name: 'gmail_trash',
    description: 'Move an email message to the Trash folder.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to trash' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_restore',
    description: 'Restore a message from the Trash folder back to its previous location.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to restore from trash' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_delete_permanently',
    description: 'Permanently and irreversibly delete an email message. This cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to permanently delete' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },

  // ── ATTACHMENTS ──────────────────────────────────────────────────────────────
  {
    name: 'gmail_list_attachments',
    description: 'List all attachments in a specific email message.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to list attachments for' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_get_attachment',
    description: 'Download an attachment from a message. Returns base64url-encoded data.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID containing the attachment',
        },
        attachmentId: { type: 'string', description: 'The attachment ID to download' },
      },
      required: ['messageId', 'attachmentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_search_attachments',
    description:
      'Search for messages that contain attachments, optionally filtered by filename or MIME type.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Optional filename or extension to filter (e.g. ".pdf" or "report.pdf")',
        },
        mimeType: {
          type: 'string',
          description: 'Optional MIME type to filter (e.g. "application/pdf")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results (1-100, default: 20)',
          default: 20,
        },
        pageToken: { type: 'string', description: 'Pagination token' },
      },
      additionalProperties: false,
    },
  },

  // ── SMART ─────────────────────────────────────────────────────────────────────
  {
    name: 'gmail_summarize_thread',
    description:
      'Generate a structured summary of an email thread, including participants, message count, and key content excerpts.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The Gmail thread ID to summarize' },
        maxMessages: {
          type: 'number',
          description: 'Max messages to include in summary (default: 10)',
          default: 10,
        },
      },
      required: ['threadId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_generate_reply',
    description:
      'Generate a suggested reply draft for an email message based on its content and desired tone.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to generate a reply for' },
        tone: {
          type: 'string',
          enum: ['professional', 'friendly', 'brief'],
          description: 'Tone of the generated reply (default: professional)',
          default: 'professional',
        },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_classify_email',
    description:
      'Classify an email into a category: newsletter, transactional, action_required, or personal.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The Gmail message ID to classify' },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_extract_actions',
    description: 'Extract action items, tasks, and to-dos from an email message.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The Gmail message ID to extract action items from',
        },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_find_newsletters',
    description:
      "Find newsletter and subscription emails in the authenticated user's Gmail account.",
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 20)',
          default: 20,
        },
        pageToken: { type: 'string', description: 'Pagination token' },
      },
      additionalProperties: false,
    },
  },
];

/**
 * Creates and configures the MCP Server instance with all 40 tool handlers
 */
export function createMcpServer(): Server {
  const server = new Server(
    { name: 'Gmail MCP', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: GMAIL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs || {}) as Record<string, unknown>;

    logger.info(`MCP tool execution request: [${name}]`);

    try {
      let resultData: unknown;

      switch (name) {
        // STATUS
        case 'gmail_mcp_status':
          resultData = await handleStatusTool();
          break;
        case 'gmail_get_profile':
          resultData = await handleProfileTool();
          break;

        // READ
        case 'gmail_search':
          resultData = await handleSearchTool(args as unknown as SearchToolInput);
          break;
        case 'gmail_list_messages':
          resultData = await handleListMessagesTool(args as unknown as ListMessagesToolInput);
          break;
        case 'gmail_get_message':
          resultData = await handleGetMessageTool(args as unknown as GetMessageToolInput);
          break;
        case 'gmail_list_threads':
          resultData = await handleListThreadsTool(args as unknown as ListThreadsToolInput);
          break;
        case 'gmail_get_thread':
          resultData = await handleGetThreadTool(args as unknown as GetThreadToolInput);
          break;

        // SEND
        case 'gmail_send':
          resultData = await handleSendTool(args as unknown as SendToolInput);
          break;
        case 'gmail_reply':
          resultData = await handleReplyTool(args as unknown as ReplyToolInput);
          break;
        case 'gmail_forward':
          resultData = await handleForwardTool(args as unknown as ForwardToolInput);
          break;

        // DRAFTS
        case 'gmail_create_draft':
          resultData = await handleCreateDraftTool(args as unknown as CreateDraftToolInput);
          break;
        case 'gmail_update_draft':
          resultData = await handleUpdateDraftTool(args as unknown as UpdateDraftToolInput);
          break;
        case 'gmail_delete_draft':
          resultData = await handleDeleteDraftTool(args as unknown as DeleteDraftToolInput);
          break;
        case 'gmail_send_draft':
          resultData = await handleSendDraftTool(args as unknown as SendDraftToolInput);
          break;

        // LABELS
        case 'gmail_list_labels':
          resultData = await handleListLabelsTool();
          break;
        case 'gmail_create_label':
          resultData = await handleCreateLabelTool(args as unknown as CreateLabelToolInput);
          break;
        case 'gmail_update_label':
          resultData = await handleUpdateLabelTool(args as unknown as UpdateLabelToolInput);
          break;
        case 'gmail_delete_label':
          resultData = await handleDeleteLabelTool(args as unknown as DeleteLabelToolInput);
          break;

        // ORGANIZE
        case 'gmail_add_label':
          resultData = await handleAddLabelTool(args as unknown as AddLabelToolInput);
          break;
        case 'gmail_remove_label':
          resultData = await handleRemoveLabelTool(args as unknown as RemoveLabelToolInput);
          break;
        case 'gmail_move_message':
          resultData = await handleMoveMessageTool(args as unknown as MoveLabelToolInput);
          break;
        case 'gmail_archive':
          resultData = await handleArchiveTool(args as unknown as ArchiveToolInput);
          break;

        // STATUS MANAGEMENT
        case 'gmail_mark_read':
          resultData = await handleMarkReadTool(args as unknown as MarkReadToolInput);
          break;
        case 'gmail_mark_unread':
          resultData = await handleMarkUnreadTool(args as unknown as MarkUnreadToolInput);
          break;
        case 'gmail_star':
          resultData = await handleStarTool(args as unknown as StarToolInput);
          break;
        case 'gmail_unstar':
          resultData = await handleUnstarTool(args as unknown as UnstarToolInput);
          break;
        case 'gmail_snooze':
          resultData = await handleSnoozeTool(args as unknown as SnoozeToolInput);
          break;

        // DELETE
        case 'gmail_trash':
          resultData = await handleTrashTool(args as unknown as TrashToolInput);
          break;
        case 'gmail_restore':
          resultData = await handleRestoreTool(args as unknown as RestoreToolInput);
          break;
        case 'gmail_delete_permanently':
          resultData = await handleDeletePermanentlyTool(
            args as unknown as DeletePermanentlyToolInput
          );
          break;

        // ATTACHMENTS
        case 'gmail_list_attachments':
          resultData = await handleListAttachmentsTool(args as unknown as ListAttachmentsToolInput);
          break;
        case 'gmail_get_attachment':
          resultData = await handleGetAttachmentTool(args as unknown as GetAttachmentToolInput);
          break;
        case 'gmail_search_attachments':
          resultData = await handleSearchAttachmentsTool(
            args as unknown as SearchAttachmentsToolInput
          );
          break;

        // SMART
        case 'gmail_summarize_thread':
          resultData = await handleSummarizeThreadTool(args as unknown as SummarizeThreadToolInput);
          break;
        case 'gmail_generate_reply':
          resultData = await handleGenerateReplyTool(args as unknown as GenerateReplyToolInput);
          break;
        case 'gmail_classify_email':
          resultData = await handleClassifyEmailTool(args as unknown as ClassifyEmailToolInput);
          break;
        case 'gmail_extract_actions':
          resultData = await handleExtractActionsTool(args as unknown as ExtractActionsToolInput);
          break;
        case 'gmail_find_newsletters':
          resultData = await handleFindNewslettersTool(args as unknown as FindNewslettersToolInput);
          break;

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(resultData, null, 2) }],
      };
    } catch (error: unknown) {
      if (error instanceof GmailNotConnectedError) {
        const user = getCurrentUser();
        let message = 'Gmail account is not connected. Please complete Google OAuth.';
        if (user.isAuthenticated && user.userId !== 'anonymous') {
          try {
            const linkUrl = createGoogleLinkToken(user.userId);
            message = `Gmail account is not connected. Please complete Google OAuth.\nOpen this one-time link to connect your Google account:\n${linkUrl}\n\nThis link connects your personal Google account to your ChatGPT MCP session. It expires in 10 minutes and can only be used once.`;
          } catch (tokenErr) {
            message = `Gmail account is not connected. Please complete Google OAuth. Failed to generate secure link: ${sanitizeErrorMessage(tokenErr)}`;
          }
        }
        logger.warn(`MCP tool [${name}] returned connection notice`);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
        };
      }

      const safeErrorMsg = sanitizeErrorMessage(error);
      logger.warn(`MCP tool [${name}] returned error: ${safeErrorMsg}`);
      return {
        content: [{ type: 'text', text: safeErrorMsg }],
        isError: true,
      };
    }
  });

  return server;
}
