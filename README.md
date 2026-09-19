# Gmail MCP (Model Context Protocol) Web Client

A standalone, production-ready, multi-user **Gmail Model Context Protocol (MCP)** server built with TypeScript, Node.js, and Google APIs. It allows AI assistants (such as ChatGPT, Claude Desktop, Cursor, and custom MCP clients) to interact securely with users' Gmail inboxes through Google OAuth 2.0 and Streamable HTTP.

> [!NOTE]
> **Production Persistent Storage Active (Supabase PostgreSQL):**
> OAuth tokens are securely encrypted at rest using AES-256-GCM before being stored in Supabase PostgreSQL (`gmail_accounts`). Decryption occurs exclusively in server memory. Gmail message contents, email bodies, and attachments are **never** persisted to Supabase or any database.

---

## Table of Contents

1. [What Gmail MCP Is](#1-what-gmail-mcp-is)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Multi-User Architecture & Isolation](#3-multi-user-architecture--isolation)
4. [Supabase Setup & Database Schema](#4-supabase-setup--database-schema)
5. [Database Migration Instructions](#5-database-migration-instructions)
6. [Google Cloud & OAuth Setup](#6-google-cloud--oauth-setup)
7. [Environment Variables](#7-environment-variables)
8. [Local Development](#8-local-development)
9. [Vercel Deployment Configuration](#9-vercel-deployment-configuration)
10. [MCP Client Connection (Streamable HTTP)](#10-mcp-client-connection-streamable-http)
11. [Security Model & Token Encryption](#11-security-model--token-encryption)
12. [TokenStore Architecture & Production Selection](#12-tokenstore-architecture--production-selection)
13. [Available MCP Tools](#13-available-mcp-tools)
14. [Security Limitations & Authentication Architecture](#14-security-limitations--authentication-architecture)

---

## 1. What Gmail MCP Is

**Gmail MCP** provides a standard Model Context Protocol interface exposing Gmail operations as structured tools to Large Language Models. It enables conversational agents to:
- Inspect connection status and server health (`gmail_mcp_status`)
- Read authenticated user profiles (`gmail_get_profile`)
- Search emails using standard Gmail query syntax (`from:`, `subject:`, `is:unread`, `after:`) (`gmail_search`)
- List and paginate inbox messages (`gmail_list_messages`)
- Retrieve full email details including sender, recipients, headers, decoded body, and attachments metadata (`gmail_get_message`)
- Retrieve conversation threads (`gmail_get_thread`)
- Compose and send emails directly through Gmail's API with RFC 2822 formatting (`gmail_send`)

---

## 2. High-Level Architecture

```
                               ┌─────────────────────────┐
                               │   AI Client (ChatGPT)   │
                               └────────────┬────────────┘
                                            │ MCP Streamable HTTP (JSON-RPC)
                                            ▼
                               ┌─────────────────────────┐
                               │     Gmail MCP Server    │
                               │   (Stateless / Vercel)  │
                               └────────────┬────────────┘
                                            │ User Context (AsyncLocalStorage)
                                            ▼
                               ┌─────────────────────────┐
                               │   GmailClientService    │
                               └──────┬────────────┬─────┘
                                      │            │
            Encrypted Token Storage   │            │ Gmail v1 API ('me')
                                      ▼            ▼
                   ┌───────────────────────┐   ┌─────────────────────────┐
                   │   SupabaseTokenStore  │   │     Google Gmail API    │
                   │ (AES-256-GCM Postgres)│   │      OAuth 2.0 Client   │
                   └───────────────────────┘   └─────────────────────────┘
```

---

## 3. Multi-User Architecture & Isolation

The server provides strict multi-user credential isolation:

```
User A ───> Authorization: Bearer A ───> Supabase (User A) ───> Gmail Account A
User B ───> Authorization: Bearer B ───> Supabase (User B) ───> Gmail Account B
User C ───> Authorization: Bearer C ───> Supabase (User C) ───> Gmail Account C
```

### Isolation Guarantees:
- **No Client-Specified Account ID**: MCP tool schemas **never** accept `user_id`, `userId`, `account`, or `gmailAccountId`.
- **Request Context Binding**: User identity is resolved at the middleware boundary via headers (`Authorization: Bearer <credential>`) and bound to Node's `AsyncLocalStorage`.
- **Query Parameter Forbidding**: On `/mcp`, query parameters (`?userId=...`) are strictly ignored and never trusted for account selection.
- **Gmail API `userId: 'me'`**: All Google API calls strictly target the authenticated OAuth client tokens belonging to that user context.
- **Database Row Scoping**: Every Supabase query explicitly filters by `eq('user_id', currentUser.userId)`.

---

## 4. Supabase Setup & Database Schema

The production token store persists encrypted credentials to the PostgreSQL table `gmail_accounts` in Supabase:

### Table Definition: `gmail_accounts`

| Column | Type | Constraints / Details |
|---|---|---|
| `id` | `uuid` | Primary Key, `DEFAULT gen_random_uuid()` |
| `user_id` | `text` | Application user identifier (indexed) |
| `google_account_id` | `text` | Google Subject ID or email fallback |
| `email` | `text` | Connected Gmail address (indexed) |
| `encrypted_access_token` | `text` | AES-256-GCM encrypted access token (`iv:authTag:cipher`) |
| `encrypted_refresh_token` | `text` | AES-256-GCM encrypted refresh token (`iv:authTag:cipher`) |
| `token_expiry` | `timestamptz` | Expiration timestamp of current access token |
| `created_at` | `timestamptz` | Timestamp when record was created |
| `updated_at` | `timestamptz` | Timestamp of last update / token refresh |

> [!IMPORTANT]
> **Data Minimization:** No email messages, bodies, subjects, search queries, or attachment files are ever stored in Supabase. Only OAuth tokens and account metadata necessary for authentication are persisted.

---

## 5. Database Migration Instructions

Apply the migration in `supabase/migrations/20260919_create_gmail_accounts_constraints.sql` using the Supabase SQL Editor or Supabase CLI:

```bash
# Using Supabase CLI:
supabase db push
```

Or execute the SQL directly in the Supabase Dashboard SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.gmail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  google_account_id TEXT,
  email TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gmail_accounts_user_google_account
ON public.gmail_accounts (user_id, COALESCE(google_account_id, email));

CREATE INDEX IF NOT EXISTS idx_gmail_accounts_user_id
ON public.gmail_accounts (user_id);

CREATE INDEX IF NOT EXISTS idx_gmail_accounts_email
ON public.gmail_accounts (email);

ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;
```

---

## 6. Google Cloud & OAuth Setup

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **APIs & Services** > **Credentials**.
3. Create an **OAuth 2.0 Client ID** (Web application).
4. Add the Authorized Redirect URI:
   ```
   https://gmail-mcp-web-client.vercel.app/api/auth/callback
   ```
5. Authorized Scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.modify`

---

## 7. Environment Variables

Configure the following environment variables in `.env` (local development) and Vercel Project Settings (production):

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google Cloud OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth Callback URL (`https://gmail-mcp-web-client.vercel.app/api/auth/callback`) |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM token encryption (`openssl rand -hex 32`) |
| `MCP_AUTH_SECRET` | Yes | Secret key used for signing OAuth state parameters |
| `SUPABASE_URL` | Yes (Prod) | Supabase project URL (`https://<project-id>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Yes (Prod) | Supabase service-role secret key (never exposed to browser) |
| `NODE_ENV` | No | `production`, `development`, or `test` |
| `PORT` | No | Server port (default: `3000`) |

---

## 8. Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env` using `.env.example`:
   ```bash
   cp .env.example .env
   # Populate GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, etc.
   ```

3. Run automated tests (69 unit and protocol tests):
   ```bash
   npm test
   ```

4. Check types and linting:
   ```bash
   npm run build
   npm run lint
   npm run format:check
   ```

5. Start the local server:
   ```bash
   npm run dev
   # Dashboard: http://localhost:3000
   # MCP Endpoint: http://localhost:3000/mcp
   ```

---

## 9. Vercel Deployment Configuration

The application is architected for Vercel serverless functions:
- Entry point: `api/index.ts` routed via `vercel.json` (`/(.*)` $\rightarrow$ `/api/index.ts`).
- Transport: Stateless Streamable HTTP (`StreamableHTTPServerTransport`).
- Storage: Persistent Supabase PostgreSQL.
- Serverless Readiness: Zero reliance on in-memory maps, local filesystem, or persistent open sockets.

---

## 10. MCP Client Connection (Streamable HTTP)

Connect remote AI clients (ChatGPT, Claude Desktop, Cursor) using **Streamable HTTP**:

- **MCP Endpoint URL**: `https://gmail-mcp-web-client.vercel.app/mcp`
- **HTTP Methods**:
  - `POST /mcp`: Sends MCP JSON-RPC messages (`initialize`, `tools/list`, `tools/call`).
  - `GET /mcp`: Standard SSE streaming (requires `Accept: text/event-stream`).
- **Authentication**: Include header `Authorization: Bearer <user_credential>`.

---

## 11. Security Model & Token Encryption

- **AES-256-GCM Authenticated Encryption**: Plaintext access and refresh tokens are encrypted in memory before database persistence. Ciphertext format: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`.
- **Reliable Token Refresh**: When Google automatically refreshes an access token, the new access token is encrypted and saved while the existing valid refresh token is preserved (never overwritten with null).
- **Log Sanitization**: Sensitive values (`access_token`, `refresh_token`, `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`) are redacted from logs.
- **CSRF & Replay Hardened State**: OAuth state parameter includes nonce, timestamp, and HMAC signature with 10-minute expiration.

---

## 12. TokenStore Architecture & Production Selection

The `TokenStore` interface decouples storage mechanism from business logic:

```typescript
export interface TokenStore {
  getUserCredentials(userId: string): Promise<OAuthCredentials | null>;
  saveUserCredentials(userId: string, credentials: OAuthCredentials): Promise<void>;
  deleteUserCredentials(userId: string): Promise<void>;
  hasUserCredentials(userId: string): Promise<boolean>;
  getStoreType(): string;
}
```

- **Production (`NODE_ENV=production`)**: Strictly selects `SupabaseTokenStore`. If `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is missing, initialization immediately throws `ConfigurationError` and **refuses** to fall back to in-memory storage.
- **Development/Test (`NODE_ENV=development | test`)**: Uses `SupabaseTokenStore` if credentials are provided in `.env`; otherwise defaults to `MemoryTokenStore` for fast, offline unit testing.

---

## 13. Available MCP Tools

All 7 Gmail tools execute with `userId: "me"` under the active session:

| Tool Name | Description | Parameters |
|---|---|---|
| `gmail_mcp_status` | Server diagnostics, configuration health, and connection status without secrets | *None* |
| `gmail_get_profile` | Email address, total messages count, total threads count | *None* |
| `gmail_search` | Search mailbox with standard Gmail query syntax | `query` (req), `maxResults`, `pageToken` |
| `gmail_list_messages` | List and paginate messages with optional label filters | `maxResults`, `pageToken`, `labelIds`, `query` |
| `gmail_get_message` | Detailed message headers, decoded body, and attachment metadata | `messageId` (req) |
| `gmail_get_thread` | Retrieve conversation thread and all messages within it | `threadId` (req) |
| `gmail_send` | Send plain text email with RFC 2822 formatting | `to`, `subject`, `body`, `cc`, `bcc`, `threadId`, `inReplyTo` |

---

## 14. Security Limitations & Authentication Architecture

- **Bearer Token Identity vs. Cryptographic JWTs**: In the current implementation, the `Authorization: Bearer <credential>` header acts as an application user credential token. For enterprise zero-trust multi-tenant deployments, this token should be issued and cryptographically verified as an OIDC / Supabase JWT signed with JWKS (`SUPABASE_JWKS_URL`) or an OAuth 2.0 Bearer token with server-side validation.
- **Service Role RLS Bypass**: Server-side requests utilize `SUPABASE_SECRET_KEY` which intentionally bypasses PostgreSQL Row Level Security (RLS). Row isolation is enforced at the application layer via explicit `user_id` query scoping.
