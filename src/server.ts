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
import { sanitizeErrorMessage } from './utils/errors.js';
import { logger } from './utils/logger.js';

export const GMAIL_TOOLS: Tool[] = [
  {
    name: 'gmail_mcp_status',
    description:
      'Check Gmail MCP server configuration status, authentication health, and TokenStore mode. Returns safe diagnostic info without secrets.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_get_profile',
    description:
      'Retrieve Gmail profile metadata (email address, total messages count, total threads count) for the currently authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_search',
    description:
      'Search the authenticated user\'s Gmail mailbox using standard Gmail query syntax (e.g. "from:alice@example.com", "subject:invoice", "is:unread", "after:2026/01/01").',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query syntax',
        },
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
        pageToken: {
          type: 'string',
          description: 'Optional pagination token',
        },
        labelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional label IDs to filter (e.g. ["INBOX", "UNREAD"])',
        },
        query: {
          type: 'string',
          description: 'Optional search query to filter messages',
        },
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
        messageId: {
          type: 'string',
          description: 'The unique Gmail message ID',
        },
      },
      required: ['messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_get_thread',
    description: 'Retrieve an entire conversation thread and all messages within it by thread ID.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'The unique Gmail thread ID',
        },
      },
      required: ['threadId'],
      additionalProperties: false,
    },
  },
  {
    name: 'gmail_send',
    description:
      "Send an email from the currently authenticated user's Gmail account. Supports To, Cc, Bcc, Subject, Body, and conversation thread continuation.",
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Recipient email address or array of recipient addresses',
        },
        cc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Optional CC email address or list of addresses',
        },
        bcc: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Optional BCC email address or list of addresses',
        },
        subject: {
          type: 'string',
          description: 'Email subject line',
        },
        body: {
          type: 'string',
          description: 'Email body content (plain text)',
        },
        threadId: {
          type: 'string',
          description: 'Optional thread ID to reply to an existing thread',
        },
        inReplyTo: {
          type: 'string',
          description: 'Optional Message-ID header value that this message is in reply to',
        },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
];

/**
 * Creates and configures the MCP Server instance with tool handlers
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'Gmail MCP',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: GMAIL_TOOLS,
    };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs || {}) as Record<string, unknown>;

    logger.info(`MCP tool execution request: [${name}]`);

    try {
      let resultData: unknown;

      switch (name) {
        case 'gmail_mcp_status':
          resultData = await handleStatusTool();
          break;

        case 'gmail_get_profile':
          resultData = await handleProfileTool();
          break;

        case 'gmail_search':
          resultData = await handleSearchTool(args as unknown as SearchToolInput);
          break;

        case 'gmail_list_messages':
          resultData = await handleListMessagesTool(args as unknown as ListMessagesToolInput);
          break;

        case 'gmail_get_message':
          resultData = await handleGetMessageTool(args as unknown as GetMessageToolInput);
          break;

        case 'gmail_get_thread':
          resultData = await handleGetThreadTool(args as unknown as GetThreadToolInput);
          break;

        case 'gmail_send':
          resultData = await handleSendTool(args as unknown as SendToolInput);
          break;

        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultData, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const safeErrorMsg = sanitizeErrorMessage(error);
      logger.warn(`MCP tool [${name}] returned error: ${safeErrorMsg}`);

      return {
        content: [
          {
            type: 'text',
            text: safeErrorMsg,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
