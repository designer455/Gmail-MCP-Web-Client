import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer, GMAIL_TOOLS } from './server.js';
import { getEnv } from './config/env.js';
import { getAuthorizationUrl } from './auth/oauth.js';
import { handleOAuthCallback } from './auth/callback.js';
import { getCurrentUser } from './auth/session.js';
import { getTokenStore } from './auth/token-store.js';
import { authMiddleware, requireAuthMiddleware } from './middleware/auth.js';
import { verifyGoogleLinkToken } from './auth/link-token.js';
import { renderLoginPage } from './views/login-page.js';
import {
  securityHeaders,
  corsMiddleware,
  httpsEnforcer,
  errorHandler,
} from './middleware/security.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { logger } from './utils/logger.js';
import { sanitizeErrorMessage } from './utils/errors.js';
import {
  getProtectedResourceMetadata,
  getAuthorizationServerMetadata,
  renderAuthorizePage,
  handleAuthorizeSubmit,
  handleTokenExchange,
} from './auth/oauth-server.js';

export interface AppOptions {
  protectMcp?: boolean;
}

export function createApp(options: AppOptions = {}): express.Application {
  const app = express();
  const protectMcp = options.protectMcp ?? process.env.NODE_ENV === 'production';

  // Basic security and parsing middlewares
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(httpsEnforcer);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(rateLimiter());

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
          <a href="/login" class="btn" style="background: rgba(255,255,255,0.1); color: #fff;">Re-authorize Account</a>
        </div>
      `
          : `
        <p>Authorize this session to connect your Gmail mailbox. Each user's tokens are strictly isolated.</p>
        <div style="margin-top: 1.25rem;">
          <a href="/login" class="btn">Connect Gmail Account →</a>
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
      <p style="color: var(--text-muted); font-size: 0.95rem;">Configure your MCP client (such as ChatGPT, Claude Desktop, or Cursor) to connect via Streamable HTTP:</p>
      <div class="info-item" style="margin-bottom: 0.75rem;">
        <div class="info-label">Streamable HTTP MCP URL</div>
        <div class="info-value"><code>https://${req.headers.host || 'gmail-mcp-web-client.vercel.app'}/mcp</code></div>
      </div>
      <div class="info-item" style="margin-bottom: 0.75rem;">
        <div class="info-label">Authentication Header</div>
        <div class="info-value"><code>Authorization: Bearer &lt;user_token&gt;</code></div>
      </div>
      <div class="info-item">
        <div class="info-label">Transport Protocol</div>
        <div class="info-value">Streamable HTTP (Stateless / Vercel Serverless Ready)</div>
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

  // Safe diagnostic endpoint verifying: MCP user → stored Gmail credential → decrypted credential → Gmail API profile
  app.get(
    '/api/diagnostic/credential-flow',
    authMiddleware,
    async (_req: Request, res: Response) => {
      const user = getCurrentUser();
      const tokenStore = getTokenStore();

      const diagnosticResult: {
        status: 'ok' | 'error';
        timestamp: string;
        stages: {
          userIdentified: boolean;
          hasStoredCredentialRecord: boolean;
          decryptionSuccessful: boolean;
          gmailApiReachable: boolean;
        };
        diagnostics: {
          userId?: string;
          emailAddress?: string;
          tokenStoreType: string;
          hasRefreshToken?: boolean;
          tokenExpiry?: string | null;
          errorMessage?: string;
        };
      } = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        stages: {
          userIdentified: user.isAuthenticated && user.userId !== 'anonymous',
          hasStoredCredentialRecord: false,
          decryptionSuccessful: false,
          gmailApiReachable: false,
        },
        diagnostics: {
          userId: user.isAuthenticated && user.userId !== 'anonymous' ? user.userId : undefined,
          tokenStoreType: tokenStore.getStoreType(),
        },
      };

      if (!diagnosticResult.stages.userIdentified) {
        diagnosticResult.status = 'error';
        diagnosticResult.diagnostics.errorMessage =
          'MCP user is not authenticated. Please provide a valid Authorization: Bearer token.';
        res.status(401).json(diagnosticResult);
        return;
      }

      try {
        // Stage 2: Stored record lookup
        const hasRecord = await tokenStore.hasUserCredentials(user.userId);
        diagnosticResult.stages.hasStoredCredentialRecord = hasRecord;

        if (!hasRecord) {
          diagnosticResult.status = 'error';
          diagnosticResult.diagnostics.errorMessage =
            'No Gmail credential record found in database for this user.';
          res.status(200).json(diagnosticResult);
          return;
        }

        // Stage 3: Retrieval & in-memory decryption
        const creds = await tokenStore.getUserCredentials(user.userId);
        if (!creds || !creds.access_token) {
          diagnosticResult.status = 'error';
          diagnosticResult.diagnostics.errorMessage =
            'Credential record exists but decryption failed or access_token is missing.';
          res.status(200).json(diagnosticResult);
          return;
        }

        diagnosticResult.stages.decryptionSuccessful = true;
        diagnosticResult.diagnostics.emailAddress = creds.emailAddress || undefined;
        diagnosticResult.diagnostics.hasRefreshToken = Boolean(creds.refresh_token);
        diagnosticResult.diagnostics.tokenExpiry = creds.expiry_date
          ? new Date(creds.expiry_date).toISOString()
          : null;

        // Stage 4: Gmail API client verification (strictly querying 'me')
        const { gmail } = await import('./gmail/client.js').then((m) =>
          m.GmailClientService.getClient()
        );
        const profile = await gmail.users.getProfile({ userId: 'me' });

        diagnosticResult.stages.gmailApiReachable = true;
        if (profile.data.emailAddress) {
          diagnosticResult.diagnostics.emailAddress = profile.data.emailAddress;
        }

        res.status(200).json(diagnosticResult);
      } catch (err: unknown) {
        diagnosticResult.status = 'error';
        diagnosticResult.diagnostics.errorMessage = sanitizeErrorMessage(err);
        res.status(200).json(diagnosticResult);
      }
    }
  );

  // RFC 9728 — OAuth 2.0 Protected Resource Metadata (for MCP & ChatGPT discovery)
  app.get('/.well-known/oauth-protected-resource', getProtectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', getProtectedResourceMetadata);

  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  app.get('/.well-known/oauth-authorization-server', getAuthorizationServerMetadata);

  // OAuth 2.1 Authorization & Token endpoints (for ChatGPT MCP connector flow)
  app.get('/oauth/authorize', renderAuthorizePage);
  app.post('/oauth/authorize', handleAuthorizeSubmit);
  app.post('/oauth/token', handleTokenExchange);
  app.options('/oauth/token', (_req: Request, res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
  });

  // One-time Google Account Linking endpoint (user opens URL generated from MCP tool)
  app.get('/auth/google/link', (req: Request, res: Response) => {
    try {
      const token = req.query['token'] as string | undefined;
      if (!token) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(400).send(renderLinkErrorHtml('Missing connection link token.'));
        return;
      }
      const { installationId } = verifyGoogleLinkToken(token);
      const { url } = getAuthorizationUrl(installationId);
      res.redirect(302, url);
    } catch (err: unknown) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).send(renderLinkErrorHtml(sanitizeErrorMessage(err)));
    }
  });

  // Google Connection Status check for authenticated installation
  app.get('/auth/google/status', authMiddleware, async (req: Request, res: Response) => {
    const user = getCurrentUser();
    const tokenStore = getTokenStore();
    const isConnected = await tokenStore.hasUserCredentials(user.userId);
    const creds = isConnected ? await tokenStore.getUserCredentials(user.userId) : null;

    res.status(200).json({
      connected: isConnected,
      installationId: user.userId,
      emailAddress: creds?.emailAddress || undefined,
    });
  });

  // Disconnect Google Account for current installation
  app.post('/auth/google/disconnect', authMiddleware, async (req: Request, res: Response) => {
    const user = getCurrentUser();
    const tokenStore = getTokenStore();
    await tokenStore.deleteUserCredentials(user.userId);
    res.status(200).json({
      success: true,
      message: 'Gmail disconnected successfully for this installation.',
    });
  });

  // Information page for direct browser visits to /login
  app.get('/login', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderLoginPage());
  });

  // Re-authorization initiation endpoint for authenticated installation
  app.get('/auth/login', authMiddleware, (req: Request, res: Response) => {
    const user = getCurrentUser();
    const redirectOverride = req.query['redirectUri'] as string | undefined;
    const { url } = getAuthorizationUrl(user.userId, redirectOverride);

    if (req.accepts('json') || req.headers['accept']?.includes('application/json')) {
      res.status(200).json({ url });
      return;
    }

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
    <p><a href="/">← Return to Dashboard</a></p>
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

  // Production-Ready Stateless MCP Streamable HTTP Transport endpoint
  // Handles POST (MCP JSON-RPC messages) and GET (streaming SSE connections where supported)
  const mcpAuth = protectMcp ? requireAuthMiddleware : authMiddleware;
  app.all('/mcp', mcpAuth, async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode (no in-memory sessions / Vercel-ready)
        enableJsonResponse: true, // Enables direct JSON responses for HTTP POST requests
      });

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);

      await transport.handleRequest(req, res, req.body);
    } catch (error: unknown) {
      const safeErrorMsg = sanitizeErrorMessage(error);
      logger.error(`Error handling /mcp request: ${safeErrorMsg}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error handling MCP request',
          },
          id: null,
        });
      }
    }
  });

  // Express centralized error handling
  app.use(errorHandler);

  return app;
}

function renderLinkErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Link Error - Gmail MCP</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1e293b; border: 1px solid #ef4444; border-radius: 1rem; padding: 2.5rem; max-width: 480px; text-align: center; }
    h1 { color: #f87171; margin-top: 0; font-size: 1.5rem; }
    p { color: #94a3b8; line-height: 1.5; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Invalid or Expired Link</h1>
    <p>${message}</p>
    <p>Please return to ChatGPT and invoke any Gmail tool to generate a fresh connection link.</p>
    <p><a href="/">← Return to Dashboard</a></p>
  </div>
</body>
</html>`;
}
