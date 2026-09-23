import { Request, Response } from 'express';
import crypto from 'crypto';
import { getEnv } from '../config/env.js';
import { encryptData, decryptData } from './crypto.js';
import { generateInstallationId } from './installation.js';
import { createMcpAccessToken } from './mcp-token.js';
import { logger } from '../utils/logger.js';
import { sanitizeErrorMessage } from '../utils/errors.js';

export interface AuthorizationCodePayload {
  installationId: string;
  userId: string; // alias to installationId
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  expiresAt: number;
  nonce: string;
}

export interface RefreshTokenPayload {
  installationId: string;
  createdAt: number;
}

// In-memory set for consumed authorization code nonces (replay protection)
const consumedNonces = new Set<string>();

export function clearOAuthConsumedNonces(): void {
  consumedNonces.clear();
}

/**
 * Computes base URL from incoming request, accounting for reverse proxies (e.g. Vercel)
 */
export function getBaseUrl(req: Request): string {
  const host = req.get('host') || 'gmail-mcp-web-client.vercel.app';
  const proto =
    req.protocol === 'http' && (host.includes('localhost') || host.includes('127.0.0.1'))
      ? 'http'
      : 'https';
  return `${proto}://${host}`;
}

/**
 * Computes HMAC-SHA256 signature
 */
function computeSignature(data: string, secret?: string): string {
  const key = secret || getEnv().MCP_AUTH_SECRET;
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Constant-time string equality check
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies PKCE S256 code challenge
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const calculated = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return timingSafeEqualStr(calculated, codeChallenge);
}

/**
 * Encrypts and cryptographically signs an authorization code
 */
export function createAuthorizationCode(payload: AuthorizationCodePayload): string {
  const plaintext = JSON.stringify(payload);
  const encrypted = encryptData(plaintext);
  const signature = computeSignature(encrypted);
  const encoded = Buffer.from(encrypted, 'utf8').toString('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Verifies, decrypts, and unpacks an authorization code
 */
export function verifyAuthorizationCode(code: string): AuthorizationCodePayload {
  const parts = code.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid authorization code format');
  }

  const [encodedEncrypted, signature] = parts;
  let encrypted: string;
  try {
    encrypted = Buffer.from(encodedEncrypted, 'base64url').toString('utf8');
  } catch {
    throw new Error('Failed to decode authorization code');
  }

  const expectedSignature = computeSignature(encrypted);
  if (!timingSafeEqualStr(signature, expectedSignature)) {
    throw new Error('Authorization code signature verification failed');
  }

  const plaintext = decryptData(encrypted);
  const payload = JSON.parse(plaintext) as AuthorizationCodePayload;

  const installId = payload.installationId || payload.userId;
  if (!installId || !payload.nonce || !payload.expiresAt || !payload.codeChallenge) {
    throw new Error('Incomplete authorization code payload');
  }

  if (Date.now() > payload.expiresAt) {
    throw new Error('Authorization code has expired');
  }

  if (consumedNonces.has(payload.nonce)) {
    throw new Error('Authorization code has already been consumed');
  }

  return {
    ...payload,
    installationId: installId,
    userId: installId,
  };
}

/**
 * Marks code nonce as consumed
 */
export function consumeAuthorizationCodeNonce(nonce: string): void {
  consumedNonces.add(nonce);
  if (consumedNonces.size > 10000) {
    consumedNonces.clear();
  }
}

/**
 * Encrypts a refresh token
 */
export function createEncryptedRefreshToken(payload: RefreshTokenPayload): string {
  const plaintext = JSON.stringify(payload);
  return encryptData(plaintext);
}

/**
 * Decrypts a refresh token
 */
export function verifyEncryptedRefreshToken(token: string): RefreshTokenPayload {
  const plaintext = decryptData(token);
  return JSON.parse(plaintext) as RefreshTokenPayload;
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata
 */
export function getProtectedResourceMetadata(req: Request, res: Response): void {
  const baseUrl = getBaseUrl(req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  res.status(200).json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['gmail', 'offline_access'],
    bearer_methods_supported: ['header'],
    resource_name: 'Gmail MCP Server',
    resource_documentation: baseUrl,
  });
}

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata
 */
export function getAuthorizationServerMetadata(req: Request, res: Response): void {
  const baseUrl = getBaseUrl(req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  res.status(200).json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['gmail', 'offline_access'],
  });
}

/**
 * Renders the OAuth Authorization & Consent page
 * GET /oauth/authorize
 */
export function renderAuthorizePage(req: Request, res: Response): void {
  const responseType = req.query['response_type'] as string | undefined;
  const clientId = req.query['client_id'] as string | undefined;
  const redirectUri = req.query['redirect_uri'] as string | undefined;
  const scope = (req.query['scope'] as string | undefined) || 'gmail offline_access';
  const state = req.query['state'] as string | undefined;
  const codeChallenge = req.query['code_challenge'] as string | undefined;
  const codeChallengeMethod = (req.query['code_challenge_method'] as string | undefined) || 'S256';

  if (responseType !== 'code') {
    res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only response_type=code is supported',
    });
    return;
  }

  if (!clientId || !redirectUri || !codeChallenge) {
    res.status(400).json({
      error: 'invalid_request',
      error_description:
        'Missing required parameters: client_id, redirect_uri, and code_challenge are mandatory',
    });
    return;
  }

  if (codeChallengeMethod !== 'S256') {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Only code_challenge_method=S256 is supported',
    });
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(
    renderAuthorizeHtml({
      clientId,
      redirectUri,
      scope,
      state: state || '',
      codeChallenge,
      codeChallengeMethod,
    })
  );
}

/**
 * Handles submission of OAuth authorization consent
 * POST /oauth/authorize
 */
export async function handleAuthorizeSubmit(req: Request, res: Response): Promise<void> {
  const wantsJson =
    req.accepts('json') &&
    (req.headers['accept']?.includes('application/json') ||
      req.headers['content-type']?.includes('application/json'));

  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.body;

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required authorization parameters',
    });
    return;
  }

  try {
    // Generate new isolated installation identity for this ChatGPT installation
    const installationId = generateInstallationId();

    // Generate 5-minute single-use authorization code
    const authCode = createAuthorizationCode({
      installationId,
      userId: installationId,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'S256',
      scope: scope || 'gmail offline_access',
      expiresAt: Date.now() + 5 * 60 * 1000,
      nonce: crypto.randomUUID(),
    });

    // Build redirect target URL with code and original state
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    logger.info(`Issued MCP authorization code for new installation [${installationId}]`);

    if (wantsJson) {
      res.status(200).json({ redirectUrl: redirectUrl.toString() });
      return;
    }

    res.redirect(302, redirectUrl.toString());
  } catch (err) {
    const safeError = sanitizeErrorMessage(err);
    logger.error(`OAuth authorize error: ${safeError}`);

    if (wantsJson) {
      res.status(500).json({
        error: 'server_error',
        message: 'An unexpected authorization error occurred.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(
      renderAuthorizeHtml({
        clientId: client_id,
        redirectUri: redirect_uri,
        scope: scope || 'gmail offline_access',
        state: state || '',
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || 'S256',
        errorMessage: 'An unexpected authorization error occurred.',
      })
    );
  }
}

/**
 * Handles OAuth 2.1 token exchange with PKCE verification
 * POST /oauth/token
 */
export async function handleTokenExchange(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const grantType = req.body['grant_type'];

  if (grantType === 'authorization_code') {
    const code = req.body['code'];
    const redirectUri = req.body['redirect_uri'];
    const clientId = req.body['client_id'];
    const codeVerifier = req.body['code_verifier'];

    if (!code) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing code parameter',
      });
      return;
    }

    if (!codeVerifier) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing code_verifier parameter (PKCE S256 required)',
      });
      return;
    }

    let payload: AuthorizationCodePayload;
    try {
      payload = verifyAuthorizationCode(code);
    } catch (err: unknown) {
      const msg = sanitizeErrorMessage(err);
      logger.warn(`OAuth token exchange rejected: ${msg}`);
      res.status(400).json({
        error: 'invalid_grant',
        error_description: msg,
      });
      return;
    }

    // Verify redirect_uri matches
    if (redirectUri && payload.redirectUri !== redirectUri) {
      logger.warn('OAuth token exchange rejected: redirect_uri mismatch');
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match authorization request',
      });
      return;
    }

    // Verify client_id matches
    if (clientId && payload.clientId !== clientId) {
      logger.warn('OAuth token exchange rejected: client_id mismatch');
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'client_id does not match authorization request',
      });
      return;
    }

    // Verify PKCE S256 challenge
    const pkceValid = verifyPkceS256(codeVerifier, payload.codeChallenge);
    if (!pkceValid) {
      logger.warn('OAuth token exchange rejected: PKCE S256 verification failed');
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'PKCE S256 verification failed',
      });
      return;
    }

    // Mark authorization code consumed (replay protection)
    consumeAuthorizationCodeNonce(payload.nonce);

    // Issue OUR OWN MCP access token containing installation identity
    const installationId = payload.installationId || payload.userId;
    const accessToken = await createMcpAccessToken(installationId);

    // Create encrypted refresh token bound to installationId
    const refreshToken = createEncryptedRefreshToken({
      installationId,
      createdAt: Date.now(),
    });

    logger.info(`Issued MCP Bearer access token for installation [${installationId}]`);

    res.status(200).json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: payload.scope || 'gmail offline_access',
    });
    return;
  }

  if (grantType === 'refresh_token') {
    const refreshToken = req.body['refresh_token'];
    if (!refreshToken) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing refresh_token parameter',
      });
      return;
    }

    let tokenData: RefreshTokenPayload;
    try {
      tokenData = verifyEncryptedRefreshToken(refreshToken);
    } catch {
      logger.warn('OAuth refresh rejected: malformed or invalid refresh_token');
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid refresh_token',
      });
      return;
    }

    const installationId = tokenData.installationId;
    const newAccessToken = await createMcpAccessToken(installationId);
    const newRefreshToken = createEncryptedRefreshToken({
      installationId,
      createdAt: Date.now(),
    });

    res.status(200).json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: 'gmail offline_access',
    });
    return;
  }

  res.status(400).json({
    error: 'unsupported_grant_type',
    error_description: `Grant type '${grantType}' is not supported`,
  });
}

// ---------------------------------------------------------------------------
// HTML Render Helper (Clean ChatGPT MCP Authorization Page)
// ---------------------------------------------------------------------------

interface AuthorizePageData {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  errorMessage?: string;
}

function renderAuthorizeHtml(data: AuthorizePageData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize ChatGPT — Gmail MCP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 28, 45, 0.9);
      --card-border: #1e293b;
      --accent: #38bdf8;
      --accent-gradient: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --error-bg: rgba(239, 68, 68, 0.15);
      --error-border: rgba(239, 68, 68, 0.3);
      --error-text: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at top, #131d33 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 1.25rem;
      padding: 2.25rem;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6);
    }
    .header {
      text-align: center;
      margin-bottom: 1.75rem;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      margin-bottom: 1rem;
      font-size: 1.5rem;
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
    }
    .desc {
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1.45;
      margin: 0;
    }
    .client-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 0.2rem 0.5rem;
      font-family: monospace;
      font-size: 0.8rem;
      color: #cbd5e1;
      margin-top: 0.5rem;
    }
    .permissions-box {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      margin: 1.5rem 0;
    }
    .permissions-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }
    .permission-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.88rem;
      color: #e2e8f0;
      margin-bottom: 0.5rem;
    }
    .permission-item:last-child { margin-bottom: 0; }
    .check {
      color: #38bdf8;
      font-weight: bold;
    }
    .btn {
      width: 100%;
      background: var(--accent-gradient);
      color: #041020;
      font-weight: 600;
      padding: 0.85rem;
      border-radius: 0.65rem;
      border: none;
      cursor: pointer;
      font-size: 0.98rem;
      transition: opacity 0.2s, transform 0.1s;
    }
    .btn:hover {
      opacity: 0.92;
      transform: translateY(-1px);
    }
    .footer {
      text-align: center;
      margin-top: 1.25rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">📬</div>
      <h1>Connect Gmail to ChatGPT</h1>
      <p class="desc">Authorize ChatGPT to securely interact with your Gmail MCP Server.</p>
      <div class="client-badge">${escapeHtml(data.clientId)}</div>
    </div>

    ${
      data.errorMessage
        ? `<div style="background: var(--error-bg); border: 1px solid var(--error-border); color: var(--error-text); padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem; font-size: 0.85rem;">${escapeHtml(data.errorMessage)}</div>`
        : ''
    }

    <div class="permissions-box">
      <div class="permissions-title">Requested Capabilities</div>
      <div class="permission-item"><span class="check">✓</span> Read Gmail messages, threads & search</div>
      <div class="permission-item"><span class="check">✓</span> Compose, reply, and draft emails</div>
      <div class="permission-item"><span class="check">✓</span> Organize labels, archives & filters</div>
    </div>

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(data.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(data.redirectUri)}">
      <input type="hidden" name="scope" value="${escapeHtml(data.scope)}">
      <input type="hidden" name="state" value="${escapeHtml(data.state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(data.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(data.codeChallengeMethod)}">
      <button type="submit" class="btn">Authorize ChatGPT</button>
    </form>

    <div class="footer">
      Credentials are encrypted with AES-256-GCM. Personal data is never logged.
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
