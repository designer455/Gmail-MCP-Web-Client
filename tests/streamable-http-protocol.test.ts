import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getTokenStore, MemoryTokenStore } from '../src/auth/token-store.js';
import type { Server } from 'node:http';

describe('Streamable HTTP Protocol Audit & Verification Tests', () => {
  let server: Server;
  const PORT = 3895;
  const BASE_URL = `http://localhost:${PORT}`;
  const MCP_URL = `${BASE_URL}/mcp`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.PORT = String(PORT);

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    const store = getTokenStore() as MemoryTokenStore;
    if (store.clear) {
      store.clear();
    }
  });

  // 1. POST /mcp & MCP initialization
  it('1. POST /mcp & MCP initialization succeeds via SDK client', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: 'Bearer user-init-test',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    expect(client.getServerVersion()?.name).toBe('Gmail MCP');
    expect(client.getServerVersion()?.version).toBe('1.0.0');

    await client.close();
  });

  // 2. GET /mcp streaming behavior & content negotiation
  it('2. GET /mcp establishes SSE stream when Accept: text/event-stream is present', async () => {
    const res = await fetch(MCP_URL, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: 'Bearer user-get-stream',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    res.body?.cancel();
  });

  it('2b. GET /mcp returns 406 Not Acceptable when Accept: text/event-stream is omitted', async () => {
    const res = await fetch(MCP_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    expect(res.status).toBe(406);
  });

  // 3 & 4. Tool discovery: all 7 registered Gmail tools
  it('3 & 4. Discovers exactly the 7 registered Gmail tools with complete schemas', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: 'Bearer user-tools-test',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    const { tools } = await client.listTools();

    expect(tools.length).toBe(7);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('gmail_mcp_status');
    expect(toolNames).toContain('gmail_get_profile');
    expect(toolNames).toContain('gmail_search');
    expect(toolNames).toContain('gmail_list_messages');
    expect(toolNames).toContain('gmail_get_message');
    expect(toolNames).toContain('gmail_get_thread');
    expect(toolNames).toContain('gmail_send');

    // Verify none of the tools allow arbitrary user_id or account selection in schema
    for (const tool of tools) {
      const properties = (tool.inputSchema as any).properties || {};
      expect(properties).not.toHaveProperty('user_id');
      expect(properties).not.toHaveProperty('userId');
      expect(properties).not.toHaveProperty('accountId');
    }

    await client.close();
  });

  // 5. gmail_mcp_status executes through protocol
  it('5. Executes gmail_mcp_status via protocol and returns safe diagnostic metadata', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: 'Bearer user-status-test',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    const result = await client.callTool({
      name: 'gmail_mcp_status',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const content = (result.content as Array<{ text: string }>)[0].text;
    const statusData = JSON.parse(content);

    expect(statusData.server).toBe('Gmail MCP');
    expect(statusData.version).toBe('1.0.0');
    expect(statusData.environment).toBe('test');
    expect(statusData.userId).toBe('user-status-test');
    expect(statusData.authenticated).toBe(false);
    expect(statusData.gmailApiConfigured).toBe(true);
    expect(statusData.oauthConfigured).toBe(true);

    // Verify secrets are NOT leaked
    expect(content).not.toContain('test-client-secret');

    await client.close();
  });

  // 6. Unauthenticated request rejection for Gmail operations
  it('6. Rejects unauthenticated tool calls targeting Gmail API with safe error', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);

    // Calling gmail_get_profile without credentials must fail
    const result = await client.callTool({
      name: 'gmail_get_profile',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const errorText = (result.content as Array<{ text: string }>)[0].text;
    expect(errorText).toContain('Gmail account is not connected');

    await client.close();
  });

  // 7. Authenticated request context resolution
  it('7. Resolves authenticated user identity from Authorization: Bearer header', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: 'Bearer authenticated-alice',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    const result = await client.callTool({
      name: 'gmail_mcp_status',
      arguments: {},
    });

    const statusData = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(statusData.userId).toBe('authenticated-alice');

    await client.close();
  });

  // 8. Strict User Isolation
  it('8. Enforces strict user isolation across concurrent requests', async () => {
    const store = getTokenStore();
    // Pre-populate credentials for user-charlie only
    await store.saveUserCredentials('user-charlie', {
      access_token: 'charlie-token',
      refresh_token: 'charlie-refresh',
      emailAddress: 'charlie@gmail.com',
    });

    const clientA = new Client({ name: 'client-a', version: '1.0.0' }, { capabilities: {} });
    await clientA.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: 'Bearer user-charlie' } },
      })
    );

    const clientB = new Client({ name: 'client-b', version: '1.0.0' }, { capabilities: {} });
    await clientB.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: 'Bearer user-bob' } },
      })
    );

    const [statusA, statusB] = await Promise.all([
      clientA.callTool({ name: 'gmail_mcp_status', arguments: {} }),
      clientB.callTool({ name: 'gmail_mcp_status', arguments: {} }),
    ]);

    const dataA = JSON.parse((statusA.content as Array<{ text: string }>)[0].text);
    const dataB = JSON.parse((statusB.content as Array<{ text: string }>)[0].text);

    expect(dataA.userId).toBe('user-charlie');
    expect(dataA.authenticated).toBe(true);
    expect(dataA.emailAddress).toBe('charlie@gmail.com');

    expect(dataB.userId).toBe('user-bob');
    expect(dataB.authenticated).toBe(false);
    expect(dataB.emailAddress).toBeUndefined();

    await clientA.close();
    await clientB.close();
  });

  // 9. Cross-user access attempt via query parameters or spoofed parameters is completely ignored
  it('9. Rejects cross-user account selection via query parameter ?userId=victim', async () => {
    // Attacker supplies ?userId=victim-user with Bearer attacker-user
    const maliciousUrl = `${MCP_URL}?userId=victim-user`;
    const transport = new StreamableHTTPClientTransport(new URL(maliciousUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer attacker-user',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    const result = await client.callTool({
      name: 'gmail_mcp_status',
      arguments: {},
    });

    const statusData = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    // MUST resolve to authenticated Bearer user, NEVER the query parameter
    expect(statusData.userId).toBe('attacker-user');
    expect(statusData.userId).not.toBe('victim-user');

    await client.close();
  });

  // 10. Gmail not connected handling
  it('10. Rejects Gmail operations with clear error when OAuth is incomplete', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: 'Bearer user-no-oauth',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    const result = await client.callTool({
      name: 'gmail_search',
      arguments: { query: 'is:unread' },
    });

    expect(result.isError).toBe(true);
    const msg = (result.content as Array<{ text: string }>)[0].text;
    expect(msg).toContain('Gmail account is not connected. Please complete Google OAuth.');

    await client.close();
  });

  // 11. Invalid MCP tool call
  it('11. Returns error response when calling non-existent tool', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: 'Bearer user-test',
        },
      },
    });

    const client = new Client({ name: 'audit-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
    const result = await client.callTool({
      name: 'non_existent_tool',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain('Unknown tool');

    await client.close();
  });

  // 12. Malformed JSON-RPC request handling
  it('12. Handles malformed JSON payload with HTTP 400 Parse error', async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: '{"invalid_json": true,',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32700); // Standard JSON-RPC Parse error
  });

  it('12b. Handles non-JSON-RPC object with HTTP 400 Invalid JSON-RPC message', async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ not_jsonrpc: true }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain('Invalid JSON-RPC');
  });

  // 13. Authentication header handling
  it('13. Correctly parses Authorization Bearer token and safely handles missing or non-Bearer headers', async () => {
    // Non-bearer header falls back to anonymous safely without throwing
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Basic dXNlcjpwYXNz',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'gmail_mcp_status',
          arguments: {},
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const result = JSON.parse(body.result.content[0].text);
    expect(result.authenticated).toBe(false);
    expect(result.userId).toBeUndefined();
  });

  // 14. Serverless & Stateless request behavior
  it('14. Succeeds on consecutive stateless requests without session state between invocations', async () => {
    // Request 1: Initialize
    const initRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer serverless-user',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 101,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'serverless-tester', version: '1.0.0' },
        },
      }),
    });

    expect(initRes.status).toBe(200);
    const initData = await initRes.json();
    expect(initData.result.serverInfo.name).toBe('Gmail MCP');

    // Request 2: Standalone tool execution without any session ID header
    const callRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer serverless-user',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'gmail_mcp_status',
          arguments: {},
        },
      }),
    });

    expect(callRes.status).toBe(200);
    const callData = await callRes.json();
    const statusResult = JSON.parse(callData.result.content[0].text);
    expect(statusResult.server).toBe('Gmail MCP');
    expect(statusResult.userId).toBe('serverless-user');
  });
});
