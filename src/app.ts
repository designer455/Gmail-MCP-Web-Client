import express, { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer, GMAIL_TOOLS } from './server.js';
import { getEnv } from './config/env.js';
import { getAuthorizationUrl } from './auth/oauth.js';
import { handleOAuthCallback } from './auth/callback.js';
import { getCurrentUser, runWithUserContext, UserContext } from './auth/session.js';
import { getTokenStore } from './auth/token-store.js';
import { authMiddleware } from './middleware/auth.js';
import {
  securityHeaders,
  corsMiddleware,
  httpsEnforcer,
  errorHandler,
} from './middleware/security.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { logger } from './utils/logger.js';
import { sanitizeErrorMessage } from './utils/errors.js';

interface ActiveSession {
  transport: SSEServerTransport;
  userContext: UserContext;
}

export function createApp(): express.Application {
  const app = express();

  // Basic security and parsing middlewares
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(httpsEnforcer);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(rateLimiter());

  // Store active SSE sessions by sessionId
  const activeSessions = new Map<string, ActiveSession>();

  // Landing page / dashboard
  app.get('/', authMiddleware, async (req: Request, res: Response) => {
    const env = getEnv();
    const tokenStore = getTokenStore();
    const user = getCurrentUser();
    const isConnected = await tokenStore.hasUserCredentials(user.userId);
    const credentials = isConnected ? await tokenStore.getUserCredentials(user.userId) : null;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gmail MCP - Model Context Protocol Server</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 28, 45, 0.85);
      --card-border: #1e293b;
      --accent: #38bdf8;
      --accent-gradient: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #34d399;
      --warning: #fbbf24;
      --code-bg: #0f172a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at top, #131d33 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2.5rem 1rem;
    }
    .container {
      max-width: 800px;
      width: 100%;
    }
    .header {
      text-align: center;
      margin-bottom: 2.5rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: var(--accent);
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0 0 0.75rem;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
      margin: 0;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.75rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .card h2 {
      font-size: 1.25rem;
      margin: 0 0 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .status-pill {
      font-size: 0.8rem;
      padding: 0.25rem 0.65rem;
      border-radius: 0.5rem;
      font-weight: 600;
    }
    .status-pill.connected {
      background: rgba(52, 211, 153, 0.15);
      color: var(--success);
      border: 1px solid rgba(52, 211, 153, 0.3);
    }
    .status-pill.disconnected {
      background: rgba(251, 191, 36, 0.15);
      color: var(--warning);
      border: 1px solid rgba(251, 191, 36, 0.3);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--accent-gradient);
      color: #041020;
      font-weight: 600;
      padding: 0.75rem 1.5rem;
      border-radius: 0.6rem;
      text-decoration: none;
      font-size: 0.95rem;
      transition: opacity 0.2s ease, transform 0.1s ease;
      cursor: pointer;
      border: none;
    }
    .btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .info-item {
      background: rgba(15, 23, 42, 0.6);
      padding: 0.85rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .info-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .info-value {
      font-size: 0.9rem;
      font-weight: 500;
      word-break: break-all;
    }
    .tools-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .tool-item {
      background: rgba(15, 23, 42, 0.4);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
    }
    .tool-name {
      font-family: 'JetBrains Mono', monospace;
      color: var(--accent);
      font-size: 0.9rem;
      font-weight: 600;
    }
    .tool-desc {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 0.25rem;
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      background: var(--code-bg);
      padding: 0.2rem 0.4rem;
      border-radius: 0.3rem;
      font-size: 0.85rem;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">Model Context Protocol Server</div>
      <h1>Gmail MCP</h1>
      <p class="subtitle">Multi-User Gmail Integration for AI Assistants & ChatGPT</p>
    </div>

    <div class="card">
      <h2>
        <span>Account Connection</span>
        <span class="status-pill ${isConnected ? 'connected' : 'disconnected'}">
          ${isConnected ? '● Connected' : '○ Not Connected'}
        </span>
      </h2>
      ${
        isConnected
          ? `
        <p>Gmail account <strong>${credentials?.emailAddress || 'Authorized'}</strong> is connected for session <code>${user.userId}</code>.</p>
        <div style="margin-top: 1rem;">
          <a href="/auth/login?userId=${encodeURIComponent(user.userId)}" class="btn" style="background: rgba(255,255,255,0.1); color: #fff;">Re-authorize Account</a>
        </div>
      `
          : `
        <p>Authorize this session to connect your Gmail mailbox. Each user's tokens are strictly isolated.</p>
        <div style="margin-top: 1.25rem;">
          <a href="/auth/login?userId=${encodeURIComponent(user.userId)}" class="btn">Connect Gmail Account →</a>
        </div>
      `
      }

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Active User ID</div>
          <div class="info-value"><code>${user.userId}</code></div>
        </div>
        <div class="info-item">
          <div class="info-label">Token Store Mode</div>
          <div class="info-value" style="font-size: 0.8rem; color: #f59e0b;">${tokenStore.getStoreType()}</div>
        </div>
        <div class="info-item">
          <div class="info-label">OAuth Redirect URI</div>
          <div class="info-value" style="font-size: 0.75rem;">${env.GOOGLE_REDIRECT_URI}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2><span>MCP Endpoint Details</span></h2>
      <p style="color: var(--text-muted); font-size: 0.95rem;">Configure your MCP client (such as ChatGPT, Claude Desktop, or Cursor) to connect via Server-Sent Events:</p>
      <div class="info-item" style="margin-bottom: 0.75rem;">
        <div class="info-label">SSE URL</div>
        <div class="info-value"><code>https://${req.headers.host || 'gmail-mcp-web-client.vercel.app'}/sse</code></div>
      </div>
      <div class="info-item">
        <div class="info-label">Messages URL</div>
        <div class="info-value"><code>https://${req.headers.host || 'gmail-mcp-web-client.vercel.app'}/message</code></div>
      </div>
    </div>

    <div class="card">
      <h2><span>Registered Gmail Tools (${GMAIL_TOOLS.length})</span></h2>
      <div class="tools-list">
        ${GMAIL_TOOLS.map(
          (t) => `
          <div class="tool-item">
            <div class="tool-name">${t.name}</div>
            <div class="tool-desc">${t.description}</div>
          </div>
        `
        ).join('')}
      </div>
    </div>
  </div>
</body>
</html>
    `);
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    const env = getEnv();
    const tokenStore = getTokenStore();
    res.json({
      status: 'ok',
      server: 'Gmail MCP',
      version: '1.0.0',
      environment: env.NODE_ENV,
      tokenStore: tokenStore.getStoreType(),
      timestamp: new Date().toISOString(),
    });
  });

  // Convenience login endpoint - initiates OAuth consent flow
  app.get('/auth/login', authMiddleware, (req: Request, res: Response) => {
    const user = getCurrentUser();
    const redirectOverride = req.query['redirectUri'] as string | undefined;
    const { url } = getAuthorizationUrl(user.userId, redirectOverride);
    res.redirect(url);
  });

  // OAuth callback route (exact path: /api/auth/callback)
  app.get('/api/auth/callback', async (req: Request, res: Response) => {
    try {
      const query = {
        code: req.query['code'] as string | undefined,
        state: req.query['state'] as string | undefined,
        error: req.query['error'] as string | undefined,
      };

      const result = await handleOAuthCallback(query);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connected - Gmail MCP</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2.5rem; max-width: 480px; text-align: center; }
    h1 { color: #38bdf8; margin-top: 0; }
    .email { display: inline-block; padding: 0.5rem 1rem; background: rgba(56, 189, 248, 0.1); border-radius: 0.5rem; color: #38bdf8; font-weight: 600; margin: 1rem 0; }
    p { color: #94a3b8; line-height: 1.5; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Gmail Account Connected</h1>
    <p>Successfully authorized Gmail access for application user <strong>${result.userId}</strong>.</p>
    <div class="email">${result.emailAddress}</div>
    <p>You can now close this tab and return to ChatGPT or your MCP client.</p>
    <p><a href="/?userId=${encodeURIComponent(result.userId)}">← Return to Dashboard</a></p>
  </div>
</body>
</html>
      `);
    } catch (error: unknown) {
      const safeError = sanitizeErrorMessage(error);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Error - Gmail MCP</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 1rem; padding: 2.5rem; max-width: 480px; text-align: center; }
    h1 { color: #f87171; margin-top: 0; }
    p { color: #94a3b8; line-height: 1.5; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connection Error</h1>
    <p>${safeError}</p>
    <p><a href="/">← Return to Dashboard</a></p>
  </div>
</body>
</html>
      `);
    }
  });

  // MCP Server-Sent Events (SSE) Transport endpoint
  app.get('/sse', authMiddleware, async (req: Request, res: Response) => {
    const userContext = getCurrentUser();
    logger.info(`New MCP SSE connection initiated for user [${userContext.userId}]`);

    const transport = new SSEServerTransport('/message', res);
    activeSessions.set(transport.sessionId, { transport, userContext });

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    req.on('close', () => {
      logger.info(`MCP SSE connection closed for session [${transport.sessionId}]`);
      activeSessions.delete(transport.sessionId);
    });
  });

  // MCP POST Message endpoint (receives JSON-RPC messages from client)
  app.post('/message', async (req: Request, res: Response) => {
    const sessionId = (req.query['sessionId'] as string) || (req.headers['x-session-id'] as string);

    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId query parameter or header' });
      return;
    }

    const session = activeSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Active MCP session not found or expired' });
      return;
    }

    // Run the MCP message handler under the isolated user context for that SSE session
    await runWithUserContext(session.userContext, async () => {
      await session.transport.handlePostMessage(req, res);
    });
  });

  // Express centralized error handling
  app.use(errorHandler);

  return app;
}
