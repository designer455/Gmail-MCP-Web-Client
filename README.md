# Gmail MCP (Model Context Protocol) Web Client

A standalone, production-ready, multi-user **Gmail Model Context Protocol (MCP)** server built with TypeScript, Node.js, and Google APIs. It allows AI assistants (such as ChatGPT, Claude Desktop, Cursor, and custom MCP clients) to interact securely with users' Gmail inboxes through Google OAuth 2.0 and Streamable HTTP.

> [!NOTE]
> **Production Persistent Storage Active (Vercel Blob):**
> OAuth tokens are securely encrypted at rest using AES-256-GCM before being stored in private Vercel Blob storage (`gmail-credentials/<installationId>.json`). Decryption occurs exclusively in server memory. Gmail message contents, email bodies, and attachments are **never** persisted to Vercel Blob or any database. Zero Supabase dependencies.

---

## Table of Contents

1. [What Gmail MCP Is](#1-what-gmail-mcp-is)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Multi-User Architecture & Installation Isolation](#3-multi-user-architecture--installation-isolation)
4. [Vercel Blob Storage & JSON Structure](#4-vercel-blob-storage--json-structure)
5. [Google Cloud & OAuth Setup](#5-google-cloud--oauth-setup)
6. [Environment Variables](#6-environment-variables)
7. [Local Development & Tests](#7-local-development--tests)
8. [Vercel Deployment Configuration](#8-vercel-deployment-configuration)
9. [MCP Client Connection (Streamable HTTP)](#9-mcp-client-connection-streamable-http)
10. [Security Model & Token Encryption](#10-security-model--token-encryption)
11. [Available MCP Tools](#11-available-mcp-tools)

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
ChatGPT / AI Client
        │
        │ MCP OAuth 2.1 + PKCE (S256)
        ▼
Gmail MCP Authorization Server
        │
        │ Issues signed MCP Bearer Token (`sub: installationId`)
        ▼
MCP Streamable HTTP (`/mcp`)
        │
        │ Resolves Installation Identity (`gm_<32-hex>`)
        ▼
Token Store & Vercel Blob
        ├── Not Connected? ──► Return single-use 10-minute Google Link URL
        └── Connected ───────► Read `gmail-credentials/<installationId>.json`
                                     │
                                     │ Decrypt AES-256-GCM in memory
                                     │ Refresh Google Access Token if expired
                                     ▼
                              Google Gmail API (`userId: "me"`)
```

---

## 3. Multi-User Architecture & Installation Isolation

The server provides strict, zero-trust cryptographic authentication and multi-user isolation:

```
ChatGPT Installation
    ↓
MCP OAuth + PKCE
    ↓
MCP Access Token (signed with MCP_AUTH_SECRET)
    ↓
Opaque Installation Identity (`gm_<random-hex>`)
    ↓
Vercel Blob Path (`gmail-credentials/<installationId>.json`)
    ↓
Decrypted in memory via AES-256-GCM
    ↓
Only Authenticated User's Gmail Mailbox (userId: "me")
```

### Authentication Guarantees:
- **Application-Owned Installation Identity**: Each installation generates an opaque, random `gm_<32-hex>` identifier without personal data or third-party user IDs.
- **Cryptographic Signature Verification**: Every Bearer token is verified using HMAC-SHA256 with `MCP_AUTH_SECRET`.
- **Zero Caller-Supplied User IDs**: No tool arguments, request bodies, query parameters (`?userId=...`), or custom headers (`X-User-ID`) can supply or override user identity.
- **Single-Use Google Linking**: Disconnected installations receive a signed, replay-protected, 10-minute one-time URL to link their personal Google account.
- **Zero Supabase**: Completely free of Supabase auth, user accounts, and PostgreSQL dependencies.

---

## 4. Vercel Blob Storage & JSON Structure

The production token store persists credentials to private Vercel Blob storage:

- **Storage Key**: `gmail-credentials/<installationId>.json`
- **Access Level**: Private server-side storage (never exposed to client or browser).

### Stored JSON Schema:

```json
{
  "version": 1,
  "installationId": "gm_0123456789abcdef0123456789abcdef",
  "googleAccountId": "1082348572918374",
  "email": "user@example.com",
  "encryptedAccessToken": "<iv_hex>:<authTag_hex>:<ciphertext_hex>",
  "encryptedRefreshToken": "<iv_hex>:<authTag_hex>:<ciphertext_hex>",
  "tokenExpiry": "2026-09-23T18:00:00.000Z",
  "scope": "https://www.googleapis.com/auth/gmail.modify",
  "tokenType": "Bearer",
  "createdAt": "2026-09-23T16:00:00.000Z",
  "updatedAt": "2026-09-23T16:00:00.000Z"
}
```

> **Data Minimization:** No email messages, bodies, subjects, search queries, or attachment files are ever stored. Only OAuth tokens and account metadata necessary for authentication are persisted.

---

## 5. Google Cloud & OAuth Setup

1. Open Google Cloud Console and create or select a project.
2. Enable the **Gmail API**.
3. Configure OAuth Consent Screen:
   - Scopes: `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/userinfo.email`
4. Create OAuth 2.0 Client ID (Web Application):
   - Authorized redirect URI: `https://<your-vercel-domain>/auth/google/callback`

---

## 6. Environment Variables

Configure the following environment variables in `.env` (local development) and Vercel Project Settings (production):

| Variable | Required | Description |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Yes (Prod) | Vercel Blob read/write access token |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM token encryption (`openssl rand -hex 32`) |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | Optional | Alias for `ENCRYPTION_KEY` |
| `MCP_AUTH_SECRET` | Yes | Secret key used for signing MCP access tokens and link tokens |
| `GOOGLE_CLIENT_ID` | Yes | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google Cloud OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | Yes | Google OAuth Callback URL (`https://<domain>/auth/google/callback`) |
| `NODE_ENV` | No | `production`, `development`, or `test` |
| `PORT` | No | Server port (default: `3000`) |

---

## 7. Local Development & Tests

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env` using `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Run automated tests (108 unit, security, and protocol tests):
   ```bash
   npm test
   ```

4. Check types, linting, and formatting:
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

## 8. Vercel Deployment Configuration

The application is architected for Vercel serverless functions:
- Entry point: `api/index.ts` routed via `vercel.json`.
- Transport: Stateless Streamable HTTP (`StreamableHTTPServerTransport`).
- Storage: Persistent Vercel Blob storage (`@vercel/blob`).
- Serverless Readiness: Zero reliance on in-memory maps or local filesystem in production.

---

## 9. MCP Client Connection (Streamable HTTP)

Connect remote AI clients (ChatGPT, Claude Desktop, Cursor) using **Streamable HTTP**:

- **MCP Endpoint URL**: `https://<your-domain>/mcp`
- **OAuth Discovery**:
  - `GET /.well-known/oauth-protected-resource`
  - `GET /.well-known/oauth-authorization-server`
  - `GET /oauth/authorize`
  - `POST /oauth/token` (PKCE S256 supported)
- **HTTP Methods**:
  - `POST /mcp`: Sends MCP JSON-RPC messages (`initialize`, `tools/list`, `tools/call`).
  - `GET /mcp`: Standard SSE streaming (requires `Accept: text/event-stream`).

---

## 10. Security Model & Token Encryption

- **AES-256-GCM Authenticated Encryption**: Plaintext access and refresh tokens are encrypted before Blob persistence. Ciphertext format: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`.
- **Reliable Token Refresh**: When Google automatically refreshes an access token, the new access token is encrypted and saved while the existing valid refresh token is preserved.
- **Log Sanitization**: Sensitive values (`access_token`, `refresh_token`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`) are redacted from logs.
- **Single-Use Replay Protection**: Link tokens and OAuth authorization codes are strictly single-use and expire within minutes.

---

## 11. Available MCP Tools

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
