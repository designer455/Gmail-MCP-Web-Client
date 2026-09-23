import { Request, Response } from 'express';
import crypto from 'crypto';
import { getEnv } from '../config/env.js';
import { getSupabaseClient } from './supabase.js';
import { encryptData, decryptData } from './crypto.js';
import { logger } from '../utils/logger.js';
import { sanitizeErrorMessage } from '../utils/errors.js';

export interface AuthorizationCodePayload {
  userId: string;
  email?: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  expiresAt: number;
  nonce: string;
  supabaseAccessToken: string;
  supabaseRefreshToken?: string;
}

export interface RefreshTokenPayload {
  userId: string;
  supabaseRefreshToken: string;
  createdAt: number;
}

// In-memory set for consumed authorization code nonces (replay protection)
const consumedNonces = new Set<string>();

// Test hooks for offline automated testing without live network calls to Supabase Auth
export type AuthSignInHandler = (
  email: string,
  pass: string
) => Promise<{
  userId: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
}>;

export type AuthRefreshHandler = (refreshToken: string) => Promise<{
  userId: string;
  accessToken: string;
  refreshToken?: string;
}>;

let testSignInHandler: AuthSignInHandler | null = null;
let testRefreshHandler: AuthRefreshHandler | null = null;

export function setTestAuthHandlers(
  signIn: AuthSignInHandler | null,
  refresh: AuthRefreshHandler | null
): void {
  testSignInHandler = signIn;
  testRefreshHandler = refresh;
}

export function clearOAuthConsumedNonces(): void {
  consumedNonces.clear();
}

/**
 * Computes base URL from incoming request, accounting for reverse proxies (e.g. Vercel)
 */
export function getBaseUrl(req: Request): string {
  const host = req.get('host') || 'gmail-mcp-web-client.vercel.app';
  // If host is loopback or localhost and protocol is http, preserve http; otherwise https
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

  if (!payload.userId || !payload.nonce || !payload.expiresAt || !payload.codeChallenge) {
    throw new Error('Incomplete authorization code payload');
  }

  if (Date.now() > payload.expiresAt) {
    throw new Error('Authorization code has expired');
  }

  if (consumedNonces.has(payload.nonce)) {
    throw new Error('Authorization code has already been consumed');
  }

  return payload;
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
 * GET /.well-known/oauth-protected-resource
 * GET /.well-known/oauth-protected-resource/mcp
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
 * GET /.well-known/oauth-authorization-server
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

  if (!clientId || !redirectUri) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: client_id and redirect_uri',
    });
    return;
  }

  if (!codeChallenge) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'PKCE code_challenge is required',
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
 * Handles the Authorization Form submission
 * POST /oauth/authorize
 */
export async function handleAuthorizeSubmit(req: Request, res: Response): Promise<void> {
  const wantsJson =
    req.headers['x-requested-with'] === 'XMLHttpRequest' ||
    req.headers['accept'] === 'application/json';

  const {
    email,
    password,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope,
  } = req.body;

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required authorization parameters',
    });
    return;
  }

  if (!email || !password) {
    if (wantsJson) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Email and password are required',
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(
      renderAuthorizeHtml({
        clientId: client_id,
        redirectUri: redirect_uri,
        scope: scope || 'gmail offline_access',
        state: state || '',
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || 'S256',
        errorMessage: 'Email and password are required',
      })
    );
    return;
  }

  try {
    let authUser: {
      userId: string;
      email: string;
      accessToken: string;
      refreshToken?: string;
    };

    if (testSignInHandler) {
      // Use test hook when running offline unit tests
      authUser = await testSignInHandler(email, password);
    } else {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.session || !data.user) {
        logger.warn(
          `OAuth sign-in failed: ${sanitizeErrorMessage(error?.message || 'Invalid credentials')}`
        );
        if (wantsJson) {
          res.status(401).json({
            error: 'invalid_grant',
            message: 'Invalid email or password. Please try again.',
          });
          return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(401).send(
          renderAuthorizeHtml({
            clientId: client_id,
            redirectUri: redirect_uri,
            scope: scope || 'gmail offline_access',
            state: state || '',
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge_method || 'S256',
            errorMessage: 'Invalid email or password. Please try again.',
          })
        );
        return;
      }

      authUser = {
        userId: data.user.id,
        email: data.user.email || email,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    }

    // Generate time-limited (5 min) authorization code
    const authCode = createAuthorizationCode({
      userId: authUser.userId,
      email: authUser.email,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'S256',
      scope: scope || 'gmail offline_access',
      expiresAt: Date.now() + 5 * 60 * 1000,
      nonce: crypto.randomUUID(),
      supabaseAccessToken: authUser.accessToken,
      supabaseRefreshToken: authUser.refreshToken,
    });

    // Build redirect target URL with code and original state
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    if (wantsJson) {
      res.status(200).json({ redirectUrl: redirectUrl.toString() });
      return;
    }

    res.redirect(302, redirectUrl.toString());
  } catch (err) {
    const safeError = sanitizeErrorMessage(err);
    const isAuthFailure =
      safeError.toLowerCase().includes('invalid') ||
      safeError.toLowerCase().includes('credential') ||
      safeError.toLowerCase().includes('password') ||
      safeError.toLowerCase().includes('login');
    const status = isAuthFailure ? 401 : 500;
    const userMessage = isAuthFailure
      ? 'Invalid email or password. Please try again.'
      : 'An unexpected authentication error occurred.';

    logger.warn(`OAuth authorize error [${status}]: ${safeError}`);
    if (wantsJson) {
      res.status(status).json({
        error: isAuthFailure ? 'invalid_grant' : 'server_error',
        message: userMessage,
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(status).send(
      renderAuthorizeHtml({
        clientId: client_id,
        redirectUri: redirect_uri,
        scope: scope || 'gmail offline_access',
        state: state || '',
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || 'S256',
        errorMessage: userMessage,
      })
    );
  }
}

/**
 * Handles Token Exchange
 * POST /oauth/token
 */
export async function handleTokenExchange(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const grantType = req.body['grant_type'];

  if (grantType === 'authorization_code') {
    const code = req.body['code'];
    const codeVerifier = req.body['code_verifier'];
    const redirectUri = req.body['redirect_uri'];
    const clientId = req.body['client_id'];

    if (!code || !codeVerifier) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing code or code_verifier parameter',
      });
      return;
    }

    let payload: AuthorizationCodePayload;
    try {
      payload = verifyAuthorizationCode(code);
    } catch (err) {
      const msg = sanitizeErrorMessage(err);
      logger.warn(`Authorization code verification failed: ${msg}`);
      res.status(400).json({
        error: 'invalid_grant',
        error_description: msg,
      });
      return;
    }

    // Verify PKCE S256
    if (!verifyPkceS256(codeVerifier, payload.codeChallenge)) {
      logger.warn('OAuth token exchange rejected: PKCE code_verifier does not match challenge');
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'PKCE verification failed: code_verifier does not match challenge',
      });
      return;
    }

    // Verify redirect_uri match if provided
    if (redirectUri && payload.redirectUri) {
      const normProvided = redirectUri.replace(/\/+$/, '');
      const normPayload = payload.redirectUri.replace(/\/+$/, '');
      if (normProvided !== normPayload) {
        logger.warn('OAuth token exchange rejected: redirect_uri mismatch');
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match authorization request',
        });
        return;
      }
    }

    // Verify client_id match if provided
    if (clientId && payload.clientId && clientId !== payload.clientId) {
      logger.warn('OAuth token exchange rejected: client_id mismatch');
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'client_id does not match authorization request',
      });
      return;
    }

    // Consume nonce to guarantee single-use replay protection
    consumeAuthorizationCodeNonce(payload.nonce);

    // Issue refresh token if offline_access is supported
    let refreshToken: string | undefined = undefined;
    if (payload.supabaseRefreshToken) {
      refreshToken = createEncryptedRefreshToken({
        userId: payload.userId,
        supabaseRefreshToken: payload.supabaseRefreshToken,
        createdAt: Date.now(),
      });
    }

    res.status(200).json({
      access_token: payload.supabaseAccessToken,
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

    try {
      let newTokens: {
        userId: string;
        accessToken: string;
        refreshToken?: string;
      };

      if (testRefreshHandler) {
        newTokens = await testRefreshHandler(tokenData.supabaseRefreshToken);
      } else {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.auth.refreshSession({
          refresh_token: tokenData.supabaseRefreshToken,
        });

        if (error || !data.session || !data.user) {
          logger.warn(
            `OAuth token refresh failed: ${sanitizeErrorMessage(error?.message || 'Refresh error')}`
          );
          res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Failed to refresh authentication session',
          });
          return;
        }

        newTokens = {
          userId: data.user.id,
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        };
      }

      const newEncryptedRefreshToken = createEncryptedRefreshToken({
        userId: newTokens.userId,
        supabaseRefreshToken: newTokens.refreshToken || tokenData.supabaseRefreshToken,
        createdAt: Date.now(),
      });

      res.status(200).json({
        access_token: newTokens.accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newEncryptedRefreshToken,
        scope: 'gmail offline_access',
      });
      return;
    } catch (err) {
      const msg = sanitizeErrorMessage(err);
      logger.error(`Error during token refresh: ${msg}`);
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Could not refresh token',
      });
      return;
    }
  }

  res.status(400).json({
    error: 'unsupported_grant_type',
    error_description: `Grant type '${grantType}' is not supported`,
  });
}

// ---------------------------------------------------------------------------
// HTML Render Helper
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
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 2.25rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.75rem;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: var(--accent);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--text-muted);
      font-size: 0.92rem;
      line-height: 1.5;
      margin: 0 0 1.5rem;
    }
    .alert-error {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: var(--error-text);
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      margin-bottom: 1.25rem;
    }
    .form-group {
      margin-bottom: 1.2rem;
    }
    label {
      display: block;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    input[type="email"], input[type="password"] {
      width: 100%;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="email"]:focus, input[type="password"]:focus {
      border-color: var(--accent);
    }
    .btn {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--accent-gradient);
      color: #041020;
      font-weight: 600;
      padding: 0.8rem 1.5rem;
      border-radius: 0.6rem;
      text-decoration: none;
      font-size: 0.95rem;
      cursor: pointer;
      border: none;
      margin-top: 0.5rem;
      transition: opacity 0.2s;
    }
    .btn:hover {
      opacity: 0.92;
    }
    .meta-box {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--card-border);
      font-size: 0.75rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Model Context Protocol</div>
    <h1>Authorize ChatGPT</h1>
    <p>Sign in with your account to authorize ChatGPT to interact with your personal Gmail mailbox.</p>

    <div id="alert-box" class="alert-error" style="${data.errorMessage ? '' : 'display:none;'}">${data.errorMessage || ''}</div>

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(data.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(data.redirectUri)}">
      <input type="hidden" name="scope" value="${escapeHtml(data.scope)}">
      <input type="hidden" name="state" value="${escapeHtml(data.state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(data.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(data.codeChallengeMethod)}">

      <div class="form-group">
        <label for="email">Account Email</label>
        <input type="email" id="email" name="email" required autocomplete="email" placeholder="you@example.com">
      </div>

      <div class="form-group">
        <label for="password">Supabase Account Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••">
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.35rem;">Enter your Supabase Auth account password (not your Google password).</div>
      </div>

      <button type="submit" id="submit-btn" class="btn">
        <span id="btn-text">Authorize ChatGPT →</span>
      </button>
    </form>

    <div class="meta-box">
      <div><strong>Client ID:</strong> ${escapeHtml(data.clientId)}</div>
      <div style="margin-top: 0.25rem;"><strong>Scope:</strong> ${escapeHtml(data.scope)}</div>
    </div>
  </div>

  <script>
    (function() {
      const form = document.querySelector('form');
      const submitBtn = document.getElementById('submit-btn');
      const btnText = document.getElementById('btn-text');
      const alertBox = document.getElementById('alert-box');

      function showError(msg) {
        alertBox.textContent = msg;
        alertBox.style.display = 'block';
        submitBtn.disabled = false;
        btnText.textContent = 'Authorize ChatGPT →';
      }

      function setLoading(msg) {
        submitBtn.disabled = true;
        btnText.textContent = msg;
        alertBox.style.display = 'none';
      }

      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        setLoading('Authorizing ChatGPT...');

        const formData = new FormData(form);
        const body = new URLSearchParams();
        for (const [key, value] of formData.entries()) {
          body.append(key, value);
        }

        try {
          const res = await fetch('/oauth/authorize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            body: body.toString()
          });

          const data = await res.json().catch(function() { return {}; });

          if (!res.ok) {
            showError(data.message || data.error_description || 'Invalid email or password. Please try again.');
            return;
          }

          if (data.redirectUrl) {
            setLoading('Redirecting to ChatGPT...');
            window.location.href = data.redirectUrl;
          } else {
            showError('Received invalid response from server.');
          }
        } catch (err) {
          showError('A network error occurred. Please try again.');
        }
      });
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
