import type { Request, Response } from 'express';
import { handleOAuthCallback } from '../../src/auth/callback.js';
import { sanitizeErrorMessage } from '../../src/utils/errors.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Serverless / Express handler for /api/auth/callback
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const query = {
      code: req.query['code'] as string | undefined,
      state: req.query['state'] as string | undefined,
      error: req.query['error'] as string | undefined,
    };

    const result = await handleOAuthCallback(query);

    // Render a polished, secure HTML confirmation screen
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gmail Connected - Gmail MCP</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --text: #f8fafc;
      --subtext: #94a3b8;
      --primary: #38bdf8;
      --success: #10b981;
      --border: #334155;
    }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 2.5rem;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      margin-bottom: 1.5rem;
    }
    h1 {
      font-size: 1.5rem;
      margin: 0 0 0.5rem;
      font-weight: 700;
    }
    p {
      color: var(--subtext);
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0 0 1.5rem;
    }
    .badge {
      display: inline-block;
      padding: 0.5rem 1rem;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 0.5rem;
      color: var(--primary);
      font-weight: 600;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
      word-break: break-all;
    }
    .instructions {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
      font-size: 0.85rem;
      color: var(--subtext);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>Gmail Account Connected</h1>
    <p>Your Google account has been authorized for this Gmail MCP session.</p>
    <div class="badge">${result.emailAddress}</div>
    <div class="instructions">
      You can safely close this window and return to ChatGPT or your AI Assistant.
    </div>
  </div>
</body>
</html>
    `);
  } catch (error: unknown) {
    const safeError = sanitizeErrorMessage(error);
    logger.error(`OAuth callback error: ${safeError}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Failed - Gmail MCP</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #1e293b;
      border: 1px solid #ef4444;
      border-radius: 1rem;
      padding: 2.5rem;
      max-width: 480px;
      text-align: center;
    }
    h1 { color: #f87171; margin-top: 0; }
    p { color: #94a3b8; line-height: 1.5; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authentication Error</h1>
    <p>${safeError}</p>
    <p><a href="/">← Return to Home</a></p>
  </div>
</body>
</html>
    `);
  }
}
