# Gmail MCP (Model Context Protocol) Web Client

A standalone, production-ready, multi-user **Gmail Model Context Protocol (MCP)** server built with TypeScript, Node.js, and Google APIs. It allows AI assistants (such as ChatGPT, Claude Desktop, Cursor, and custom MCP clients) to interact securely with users' Gmail inboxes through Google OAuth 2.0.

> [!IMPORTANT]
> **Persistent database storage is NOT implemented in the current phase.**
> The server includes an extensible `TokenStore` abstraction and runs with a development-only in-memory token store explicitly designated as `[ NON-PRODUCTION TOKEN STORAGE ]`. No credentials are saved to the Vercel filesystem or local JSON files. Phase 2 will introduce an encrypted persistent database without altering Gmail or MCP business logic.

---

## Table of Contents

1. [What Gmail MCP Is](#1-what-gmail-mcp-is)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Multi-User Architecture & Isolation](#3-multi-user-architecture--isolation)
4. [Google Cloud Setup](#4-google-cloud-setup)
5. [Gmail API Setup](#5-gmail-api-setup)
6. [OAuth Setup & Flow](#6-oauth-setup--flow)
7. [OAuth Scopes](#7-oauth-scopes)
8. [Redirect URI](#8-redirect-uri)
9. [Environment Variables](#9-environment-variables)
10. [Local Development](#10-local-development)
11. [Vercel Deployment](#11-vercel-deployment)
12. [MCP Client Connection](#12-mcp-client-connection)
13. [Security Model](#13-security-model)
14. [TokenStore Architecture](#14-tokenstore-architecture)
15. [Current Limitations](#15-current-limitations)
16. [Future Persistent Storage Plan](#16-future-persistent-storage-plan)
17. [Available MCP Tools](#17-available-mcp-tools)

---

## 1. What Gmail MCP Is

**Gmail MCP** provides a standard Model Context Protocol interface exposing Gmail operations as structured tools to Large Language Models. It enables conversational agents to:
- Inspect connection status and server health
- Read authenticated user profiles
- Search emails using standard Gmail search syntax (`from:`, `subject:`, `is:unread`, `after:`)
- List and paginate inbox messages
- Retrieve full email details (sender, recipient, subject, headers, plain text / HTML body, attachment metadata)
- Retrieve full conversation threads
- Compose and send emails directly through Gmail's API with RFC 2822 formatting

---

## 2. High-Level Architecture

```
                               ┌─────────────────────────┐
                               │   AI Client (ChatGPT)   │
                               └────────────┬────────────┘
                                            │ MCP / SSE (JSON-RPC)
                                            ▼
                               ┌─────────────────────────┐
                               │     Gmail MCP Server    │
                               │  (Express + MCP SDK)    │
                               └────────────┬────────────┘
                                            │ User Context (AsyncLocalStorage)
                                            ▼
                               ┌─────────────────────────┐
                               │   GmailClientService    │
                               └──────┬────────────┬─────┘
                                      │            │
             Token Retrieval & Crypto │            │ Gmail v1 API ('me')
                                      ▼            ▼
                   ┌───────────────────────┐   ┌─────────────────────────┐
                   │       TokenStore      │   │     Google Gmail API    │
                   │ (AES-256-GCM Memory)  │   │      OAuth 2.0 Client   │
                   └───────────────────────┘   └─────────────────────────┘
```

---

## 3. Multi-User Architecture & Isolation

The server is designed from the ground up for strict multi-user isolation:

```
User A ───> Google OAuth ───> Gmail Account A ───> Isolated Session A
User B ───> Google OAuth ───> Gmail Account B ───> Isolated Session B
User C ───> Google OAuth ───> Gmail Account C ───> Isolated Session C
```

### Isolation Guarantees:
- **No Client-Specified Account ID**: MCP tool inputs **NEVER** accept `user_id`, `accountId`, or `gmailAccountId`.
- **Request Context Binding**: The user identity is resolved at the middleware boundary via headers (`X-User-ID`, `Authorization: Bearer <token>`) and bound to Node's `AsyncLocalStorage`.
- **`getCurrentUser()` Enforcement**: All service methods and MCP tool handlers fetch credentials exclusively for the active user in the execution context.
- **Gmail API `userId: 'me'`**: All Google API calls strictly target the special `'me'` identifier belonging to the authenticated OAuth client tokens.

---

## 4. Google Cloud Setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a Google Cloud Project (e.g. `gmail-mcp-509110`).
3. Navigate to **APIs & Services** > **OAuth consent screen**.
4. Configure the consent screen as **External** or **Internal** (for Google Workspace).
5. Add your test users or submit for verification if publishing broadly.

---

## 5. Gmail API Setup

1. In the Google Cloud Console, navigate to **APIs & Services** > **Library**.
2. Search for **Gmail API**.
3. Click **Enable**.

---

## 6. OAuth Setup & Flow

1. Navigate to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Select **Web application** as application type.
4. Set Name: `Gmail MCP Web Client`.
5. Under **Authorized JavaScript origins**:
   - `https://gmail-mcp-web-client.vercel.app`
   - `http://localhost:3000` (for local development)
6. Under **Authorized redirect URIs**:
   - `https://gmail-mcp-web-client.vercel.app/api/auth/callback`
   - `http://localhost:3000/api/auth/callback` (for local development)

### The OAuth 2.0 Flow:
```
User / Client
    │
    ▼
GET /auth/login (or direct OAuth URL)
    │ Generates cryptographically signed HMAC state + CSRF nonce
    ▼
Google OAuth Authorization Screen (Consent)
    │ User accepts Gmail permissions
    ▼
GET /api/auth/callback?code=...&state=...
    │ 1. Validate state signature, expiration, and replay protection
    │ 2. Exchange code for access & refresh tokens
    │ 3. Fetch user email via users.getProfile({ userId: 'me' })
    │ 4. Encrypt and save tokens in TokenStore under active user ID
    ▼
Connected Confirmation Screen
```

---

## 7. OAuth Scopes

This application strictly requests only these 4 Gmail scopes:

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Read messages, threads, metadata, and attachments |
| `https://www.googleapis.com/auth/gmail.send` | Send emails on behalf of the user |
| `https://www.googleapis.com/auth/gmail.compose` | Create drafts and compose messages |
| `https://www.googleapis.com/auth/gmail.modify` | Modify labels and organize mailbox |

*Note: No Google Drive, Calendar, Contacts, or unrestricted scopes are requested.*

---

## 8. Redirect URI

The production OAuth callback URL is:
```
https://gmail-mcp-web-client.vercel.app/api/auth/callback
```
The server routes both `/api/auth/callback` directly and within the Vercel serverless functions in `api/auth/callback.ts`.

---

## 9. Environment Variables

Create your local `.env` file based on `.env.example`:

```bash
# Google Cloud OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=https://gmail-mcp-web-client.vercel.app/api/auth/callback

# 32-byte hexadecimal key for AES-256-GCM encryption
ENCRYPTION_KEY=your_32_byte_hex_encryption_key_here

# Secret used to sign HMAC OAuth state parameters and user session tokens
MCP_AUTH_SECRET=your_mcp_auth_secret_here

# Environment & Server
NODE_ENV=development
PORT=3000
```

> [!CAUTION]
> **Zero Database in Phase 1**: Do NOT set `DATABASE_URL`. Never commit `.env` or OAuth credentials to Git.

---

## 10. Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the TypeScript codebase:
   ```bash
   npm run build
   ```

3. Run the automated test suite (40 tests):
   ```bash
   npm test
   ```

4. Check linting:
   ```bash
   npm run lint
   ```

5. Start the local development server:
   ```bash
   npm run dev
   # Server runs on http://localhost:3000
   ```

6. Open `http://localhost:3000` to inspect the web dashboard and initiate the OAuth flow.

---

## 11. Vercel Deployment

The application includes `vercel.json` and serverless functions in `api/`:

1. Connect the GitHub repository `designer455/Gmail-MCP-Web-Client` to Vercel.
2. In the Vercel Project Settings, add the Environment Variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (`https://gmail-mcp-web-client.vercel.app/api/auth/callback`)
   - `ENCRYPTION_KEY`
   - `MCP_AUTH_SECRET`
   - `NODE_ENV` (`production`)
3. Deploy the project. The production site will be live at:
   ```
   https://gmail-mcp-web-client.vercel.app
   ```

---

## 12. MCP Client Connection

MCP clients (e.g. ChatGPT, Claude Desktop, Cursor) connect using the **Server-Sent Events (SSE)** transport:

### Connection Parameters:
- **SSE URL**: `https://gmail-mcp-web-client.vercel.app/sse`
- **Messages URL**: `https://gmail-mcp-web-client.vercel.app/message`
- **User Header**: Include `X-User-ID: <unique_user_identifier>` (or `Authorization: Bearer <token>`)

---

## 13. Security Model

- **Zero Credential Leakage**: Loggers automatically redact access tokens, refresh tokens, auth codes, and client secrets.
- **AES-256-GCM Encryption**: Token data is encrypted using authenticated AES-256-GCM before storage.
- **OAuth State Hardening**: State contains a unique nonce, timestamp, and HMAC-SHA256 signature to block CSRF and replay attacks.
- **Ephemeral Email Handling**: Email bodies and attachment payloads flow directly from Gmail to the MCP client; they are **never** persisted to disk or databases.
- **Sanitized Errors**: No internal file paths or stack traces are leaked to clients or tool responses.

---

## 14. TokenStore Architecture

`TokenStore` is an interface with clear CRUD contracts:

```typescript
export interface TokenStore {
  getUserCredentials(userId: string): Promise<OAuthCredentials | null>;
  saveUserCredentials(userId: string, credentials: OAuthCredentials): Promise<void>;
  deleteUserCredentials(userId: string): Promise<void>;
  hasUserCredentials(userId: string): Promise<boolean>;
  getStoreType(): string;
}
```

- In this phase, `MemoryTokenStore` provides an in-memory implementation for testing and development.
- Tokens are encrypted via `encryptCredentials()` before storage to test the complete cryptographic pipeline.

---

## 15. Current Limitations

- **In-Memory Ephemeral Storage**: On serverless environments (e.g. Vercel), server instances spin down between requests; token state is not permanently stored across reboots without Phase 2 persistent storage.
- **Scope Boundary**: Implements strictly the 7 initial tools; drafts, label modifications, and batch operations are reserved for subsequent phases.

---

## 16. Future Persistent Storage Plan (Phase 2)

In Phase 2, a persistent database adapter (e.g. PostgreSQL with encrypted columns or Supabase/Neon) will implement the `TokenStore` interface. Because `GmailClientService` and all MCP tools depend solely on the `TokenStore` abstraction, the database will be plugged in with **zero modifications** to the Gmail API logic or MCP tools.

---

## 17. Available MCP Tools

| Tool Name | Description | Parameters |
|---|---|---|
| `gmail_mcp_status` | Returns server diagnostics, environment, configuration health, and connection status without secrets. | *None* |
| `gmail_get_profile` | Retrieves current user's email address, total message count, and thread count. | *None* |
| `gmail_search` | Searches mailbox using standard Gmail queries (e.g., `from:`, `is:unread`, `subject:`). | `query` (required), `maxResults` (optional, default 20), `pageToken` (optional) |
| `gmail_list_messages` | Lists messages with optional label filtering and pagination. | `maxResults` (optional), `pageToken` (optional), `labelIds` (optional), `query` (optional) |
| `gmail_get_message` | Retrieves full email details, headers, decoded body, and attachment metadata. | `messageId` (required) |
| `gmail_get_thread` | Retrieves a full conversation thread and all nested messages. | `threadId` (required) |
| `gmail_send` | Sends an email with RFC 2822 formatting from the authenticated account. | `to` (required), `cc` (optional), `bcc` (optional), `subject` (required), `body` (required), `threadId` (optional), `inReplyTo` (optional) |
