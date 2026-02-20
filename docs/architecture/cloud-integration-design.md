# Oboto Cloud Integration Design — Client Side

## Table of Contents

1. [Three-Component Model](#1-three-component-model)
2. [Design Constraints](#2-design-constraints)
3. [Cloud API Surface](#3-cloud-api-surface)
4. [Module Architecture](#4-module-architecture)
5. [Wiring Into Existing Architecture](#5-wiring-into-existing-architecture)
6. [AI Proxy Provider Integration](#6-ai-proxy-provider-integration)
7. [Data Sync Strategy](#7-data-sync-strategy)
8. [Realtime Protocol](#8-realtime-protocol)
9. [UI Integration](#9-ui-integration)
10. [Configuration](#10-configuration)
11. [Implementation Phases](#11-implementation-phases)

---

## 1. Three-Component Model

Oboto consists of three distinct components with clear boundaries:

```
┌─────────────────┐     WebSocket      ┌─────────────────┐     HTTPS/WSS      ┌─────────────────┐
│                 │ ◄──────────────── │                 │ ◄──────────────── │                 │
│   1. UI         │                    │   2. Oboto      │                    │   3. Oboto      │
│   (React SPA)   │ ────────────────► │   Server        │ ────────────────► │   Cloud         │
│                 │     wsService.ts   │   (Node.js)     │   native fetch()  │   (Lovable +    │
│   Browser tab   │                    │   localhost:3000 │   native WebSocket│   Supabase)     │
│                 │                    │                 │                    │                 │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

### Component 1: UI (React SPA)

- Lives in `ui/src/`
- Communicates exclusively with the local Oboto Server via `wsService.ts` WebSocket
- **Knows nothing about the cloud backend.** It receives cloud state (user, org, presence, sync status) through the same WS channel it uses for everything else
- Renders cloud-related UI elements (login panel, presence bar, sync indicator) based on WS events
- Never makes direct HTTP calls to any cloud service

### Component 2: Oboto Server (Node.js)

- Lives in `src/`
- The workhorse. Runs locally on the user's machine
- Handles AI inference, tool execution, file operations, agent loop, scheduling, etc.
- **Cloud is strictly optional.** The server runs perfectly without any cloud connection
- When cloud is enabled, uses native `fetch()` and `WebSocket` to communicate with the cloud backend — **zero cloud SDK dependencies**
- Acts as a bridge/proxy between the UI and the cloud: the UI sends cloud-related WS messages to the server, the server calls the cloud REST API, and relays results back to the UI

### Component 3: Oboto Cloud (Lovable + Supabase)

- Lives in the `oboto-1fdb6109` repository
- Provides: user authentication, workspace storage, conversation persistence, team/org management, cloud AI agents, AI provider proxy (metered), real-time collaboration, file storage
- Built on Supabase (PostgreSQL, Auth, Edge Functions, Realtime, Storage, pgvector)
- Exposes standard REST and WebSocket endpoints — no proprietary protocol
- The Supabase SDK (`@supabase/supabase-js`) exists **only** in this codebase

### Boundary Rules

| Rule | Description |
|------|-------------|
| **No Supabase in ai-man** | The `@supabase/supabase-js` package is never installed in the ai-man project |
| **UI → Server only** | The React UI never communicates directly with the cloud. All cloud interactions go through the Oboto Server's WS channel |
| **Server → Cloud via fetch** | The Oboto Server communicates with the cloud using native `fetch()` and `WebSocket` — standard HTTP/WS protocols |
| **Cloud is swappable** | Because ai-man uses plain REST/WS, the cloud backend could be replaced with any system exposing the same API shape |
| **Graceful degradation** | If cloud is unavailable, offline, or not configured, every local feature works identically. Cloud features simply don't appear in the UI |

## 2. Design Constraints

### Hard Constraints

1. **Zero cloud dependencies in `package.json`**: No Supabase SDK, no Firebase SDK, no cloud-specific packages. The cloud module uses only `fetch()` (native in Node 18+) and `WebSocket` (the `ws` package already in deps for the local WS server).

2. **Local-first, cloud-enhanced**: Every feature that works today continues to work identically without a cloud connection. Cloud adds sync, collaboration, and metered AI access — it never removes or gates existing functionality.

3. **Tool execution stays local**: The cloud **never** executes code, file operations, shell commands, or browser automation. These always run on the user's machine. The cloud stores state and proxies AI calls.

4. **Single auth boundary**: The user logs in once (email/password or OAuth through the cloud's auth endpoint). The resulting JWT is stored securely on the server side and used for all subsequent cloud API calls. The UI never handles auth tokens directly.

5. **Optional service pattern**: The cloud module registers into the existing `ServiceRegistry` as an optional service. Consumers use `services.optional('cloudSync')` — if it returns null, cloud features are silently skipped. No conditional imports, no feature flags in hot paths.

### Soft Constraints

6. **Minimal realtime complexity**: For Phase 1, we can skip the Phoenix Channel wire protocol and use polling or SSE for cloud updates. Full realtime (presence, live cursors) is Phase 4.

7. **No data model changes**: The existing `WorkspaceManager`, `ConversationManager`, and `HistoryManager` classes are not modified. The cloud module wraps/observes them and syncs their state externally.

8. **Token caching via existing infrastructure**: Auth tokens are stored using the existing `SecretsManager` vault (`src/server/secrets-manager.mjs`), not a new storage mechanism.

## 3. Cloud API Surface

These are the REST and WebSocket endpoints that the Oboto Server calls on the cloud backend. From ai-man's perspective, these are just URLs — it doesn't know or care that they're backed by Supabase.

All requests include two headers:
```
apikey: {OBOTO_CLOUD_KEY}          # Public anon key (safe to embed)
Authorization: Bearer {jwt_token}   # User's access token (after login)
```

### 3.1 Authentication

#### Login (Email/Password)
```
POST {CLOUD_URL}/auth/v1/token?grant_type=password
Content-Type: application/json
apikey: {OBOTO_CLOUD_KEY}

Body: {
  "email": "user@example.com",
  "password": "secret"
}

Response 200: {
  "access_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600,
  "expires_at": 1740000000,
  "refresh_token": "abc123...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "app_metadata": { ... },
    "user_metadata": { ... }
  }
}
```

#### Refresh Token
```
POST {CLOUD_URL}/auth/v1/token?grant_type=refresh_token
Content-Type: application/json
apikey: {OBOTO_CLOUD_KEY}

Body: {
  "refresh_token": "abc123..."
}

Response 200: { access_token, refresh_token, expires_in, ... }
```

#### Logout
```
POST {CLOUD_URL}/auth/v1/logout
Authorization: Bearer {access_token}
apikey: {OBOTO_CLOUD_KEY}

Response 204: (no body)
```

#### Get Current User
```
GET {CLOUD_URL}/auth/v1/user
Authorization: Bearer {access_token}
apikey: {OBOTO_CLOUD_KEY}

Response 200: { id, email, app_metadata, user_metadata, ... }
```

### 3.2 User Profile

```
GET {CLOUD_URL}/rest/v1/profiles?id=eq.{userId}&select=*
Authorization: Bearer {token}
apikey: {key}

Response 200: [{
  "id": "uuid",
  "display_name": "Alice",
  "avatar_url": "https://...",
  "bio": "...",
  "preferences": {},
  "onboarding_completed": true,
  "last_active_at": "2026-02-19T..."
}]
```

### 3.3 Organization & Membership

#### Get User's Organization (with membership)
```
GET {CLOUD_URL}/rest/v1/org_memberships?user_id=eq.{userId}&select=org_id,role,organizations(*)&order=joined_at.asc&limit=1
Authorization: Bearer {token}
apikey: {key}

Response 200: [{
  "org_id": "uuid",
  "role": "owner",
  "organizations": {
    "id": "uuid",
    "name": "My Org",
    "slug": "my-org",
    "subscription_tier": "free",
    "subscription_status": "active",
    "max_members": 3,
    "max_workspaces": 1,
    ...
  }
}]
```

### 3.4 Workspaces

#### List Workspaces
```
GET {CLOUD_URL}/rest/v1/workspaces?org_id=eq.{orgId}&select=id,name,slug,description,status,task_goal,current_step,last_active_at
Authorization: Bearer {token}
apikey: {key}

Response 200: [{ id, name, slug, status, task_goal, ... }, ...]
```

#### Get Single Workspace
```
GET {CLOUD_URL}/rest/v1/workspaces?id=eq.{wsId}&select=*
```

#### Update Workspace State (Push)
```
PATCH {CLOUD_URL}/rest/v1/workspaces?id=eq.{wsId}
Authorization: Bearer {token}
apikey: {key}
Content-Type: application/json
Prefer: return=representation

Body: {
  "task_goal": "Build auth module",
  "current_step": "Writing tests",
  "status": "in_progress",
  "progress_data": { "files_created": 5 },
  "next_steps": ["Run tests", "Code review"],
  "shared_memory": { ... },
  "last_active_at": "2026-02-19T..."
}
```

### 3.5 Conversations & Messages

#### List Conversations in Workspace
```
GET {CLOUD_URL}/rest/v1/conversations?workspace_id=eq.{wsId}&select=id,name,conversation_type,is_archived,created_at&order=created_at.asc
```

#### Create Conversation
```
POST {CLOUD_URL}/rest/v1/conversations
Body: { "workspace_id": "uuid", "name": "chat", "conversation_type": "chat", "started_by": "userId" }
```

#### Get Messages
```
GET {CLOUD_URL}/rest/v1/messages?conversation_id=eq.{convId}&select=*&order=created_at.asc&limit=100
```

#### Post Message
```
POST {CLOUD_URL}/rest/v1/messages
Body: {
  "conversation_id": "uuid",
  "content": "Hello team",
  "role": "user",
  "sender_user_id": "uuid"
}
```

### 3.6 Cloud Agents

#### List Agents
```
GET {CLOUD_URL}/rest/v1/cloud_agents?org_id=eq.{orgId}&select=id,name,slug,agent_type,description,status,avatar_url
```

#### Invoke Agent (Edge Function)
```
POST {CLOUD_URL}/functions/v1/agent-chat
Authorization: Bearer {token}
Content-Type: application/json

Body: {
  "agentSlug": "code-reviewer",
  "conversationId": "uuid",
  "userMessage": "Review this code...",
  "messageHistory": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

Response 200: {
  "content": "Here's my review...",
  "messageId": "uuid",
  "agentName": "Code Reviewer"
}
```

### 3.7 AI Proxy (Edge Function — Future)

```
POST {CLOUD_URL}/functions/v1/ai-proxy
Authorization: Bearer {token}
Content-Type: application/json

Body: {
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "messages": [{ "role": "user", "content": "..." }],
  "stream": false,
  "workspace_id": "uuid"
}

Response 200: {
  "choices": [{
    "message": { "role": "assistant", "content": "..." }
  }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 200 }
}
```

When `stream: true`, the response is Server-Sent Events (SSE):
```
data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"content":" world"}}]}
data: [DONE]
```

### 3.8 Workspace Members & Presence

#### Get Workspace Members
```
GET {CLOUD_URL}/rest/v1/workspace_members?workspace_id=eq.{wsId}&select=user_id,role,last_seen_at,profiles(display_name,avatar_url)
```

#### Update Own Presence
```
PATCH {CLOUD_URL}/rest/v1/workspace_members?workspace_id=eq.{wsId}&user_id=eq.{userId}
Body: { "last_seen_at": "2026-02-19T...", "cursor_position": { "file": "src/main.ts", "line": 42 } }
```

### 3.9 Activity Feed

```
GET {CLOUD_URL}/rest/v1/activity_feed?org_id=eq.{orgId}&order=created_at.desc&limit=50
```

### 3.10 File Storage

#### Upload File
```
POST {CLOUD_URL}/storage/v1/object/workspace-files/{wsId}/{filePath}
Authorization: Bearer {token}
apikey: {key}
Content-Type: application/octet-stream

Body: (raw file bytes)
```

#### Download File
```
GET {CLOUD_URL}/storage/v1/object/workspace-files/{wsId}/{filePath}
Authorization: Bearer {token}
apikey: {key}
```

#### List Files
```
POST {CLOUD_URL}/storage/v1/object/list/workspace-files
Body: { "prefix": "{wsId}/", "limit": 100 }
```

## 4. Module Architecture

### 4.1 File Structure

```
src/cloud/                          # NEW directory — all cloud integration code
  cloud-config.mjs                  # Config loading + validation
  cloud-client.mjs                  # Generic REST client (fetch-based)
  cloud-auth.mjs                    # Auth lifecycle (login/logout/refresh/cache)
  cloud-sync.mjs                    # Main orchestrator — the "CloudSync" service
  cloud-workspace-sync.mjs          # Workspace state push/pull
  cloud-conversation-sync.mjs       # Conversation/message sync
  cloud-agent.mjs                   # Cloud agent invocation
  cloud-realtime.mjs                # WebSocket realtime connection (Phase 4)

src/server/ws-handlers/
  cloud-handler.mjs                 # NEW — WS message handler for all cloud:* types

ui/src/
  hooks/useCloudSync.ts             # NEW — React hook for cloud state
  components/features/
    CloudAccountPanel.tsx           # NEW — Login/logout/profile panel
    CloudPresenceBar.tsx            # NEW — Online team members indicator
    CloudSyncIndicator.tsx          # NEW — Sync status in status bar
    settings/CloudSettings.tsx      # NEW — Cloud configuration tab in settings
```

### 4.2 `CloudConfig` — Configuration

```javascript
// src/cloud/cloud-config.mjs

/**
 * Loads cloud configuration from environment variables.
 * Returns null if cloud is not configured (missing URL or key).
 */
export function loadCloudConfig() {
  const url = process.env.OBOTO_CLOUD_URL;
  const key = process.env.OBOTO_CLOUD_KEY;

  if (!url || !key) return null;

  return {
    baseUrl: url.replace(/\/$/, ''),   // Strip trailing slash
    anonKey: key,
    autoLogin: process.env.OBOTO_CLOUD_AUTO_LOGIN !== 'false',  // Default: true
    syncInterval: parseInt(process.env.OBOTO_CLOUD_SYNC_INTERVAL || '30000', 10),  // 30s
    presenceInterval: parseInt(process.env.OBOTO_CLOUD_PRESENCE_INTERVAL || '60000', 10),  // 60s
  };
}
```

### 4.3 `CloudClient` — Generic REST Client

```javascript
// src/cloud/cloud-client.mjs

/**
 * Zero-dependency REST client for communicating with Oboto Cloud.
 * Uses native fetch(). All methods throw on HTTP errors.
 */
export class CloudClient {
  /**
   * @param {string} baseUrl — Cloud base URL (e.g. "https://xyz.supabase.co")
   * @param {string} anonKey — Public anon key
   */
  constructor(baseUrl, anonKey) {
    this.baseUrl = baseUrl;
    this.anonKey = anonKey;
    this.accessToken = null;
  }

  /**
   * Set the current access token (called by CloudAuth after login/refresh).
   * @param {string|null} token
   */
  setAccessToken(token) {
    this.accessToken = token;
  }

  /**
   * Generic fetch wrapper. Adds apikey and Authorization headers.
   * @param {string} path — URL path (e.g. "/rest/v1/profiles")
   * @param {object} [options] — fetch options (method, body, headers, etc.)
   * @returns {Promise<any>} Parsed JSON response
   * @throws {Error} On non-2xx status
   */
  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': this.anonKey,
      ...(this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {}),
      ...options.headers,
    };

    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers,
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Cloud API ${res.status}: ${text}`);
      err.status = res.status;
      err.url = url;
      throw err;
    }

    if (res.status === 204) return null;

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    return res.text();
  }

  /** Convenience: GET */
  get(path, headers) { return this.request(path, { method: 'GET', headers }); }

  /** Convenience: POST */
  post(path, body, headers) { return this.request(path, { method: 'POST', body, headers }); }

  /** Convenience: PATCH */
  patch(path, body, headers) {
    return this.request(path, {
      method: 'PATCH', body,
      headers: { 'Prefer': 'return=representation', ...headers }
    });
  }

  /** Convenience: DELETE */
  delete(path, headers) { return this.request(path, { method: 'DELETE', headers }); }

  /**
   * Stream a POST request (for SSE responses like ai-proxy).
   * Returns an async iterator of parsed SSE data events.
   * @param {string} path
   * @param {object} body
   * @returns {AsyncGenerator<object>}
   */
  async *stream(path, body) {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': this.anonKey,
      ...(this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {}),
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloud API stream ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') return;

        try {
          yield JSON.parse(jsonStr);
        } catch { /* skip partial JSON */ }
      }
    }
  }
}
```

### 4.4 `CloudAuth` — Authentication Lifecycle

```javascript
// src/cloud/cloud-auth.mjs

/**
 * Manages authentication state: login, logout, token refresh, caching.
 *
 * Token caching uses the existing SecretsManager vault so that refresh
 * tokens survive server restarts without introducing new storage.
 *
 * Emits events on the EventBus:
 *   cloud:auth:logged-in   { user, profile, org }
 *   cloud:auth:logged-out  {}
 *   cloud:auth:error       { error }
 */
export class CloudAuth {
  /**
   * @param {CloudClient} client
   * @param {AiManEventBus} eventBus
   * @param {SecretsManager} secretsManager
   */
  constructor(client, eventBus, secretsManager) {
    this.client = client;
    this.eventBus = eventBus;
    this.secretsManager = secretsManager;

    this.user = null;          // auth.users row
    this.profile = null;       // profiles row
    this.org = null;           // organizations row
    this.membership = null;    // org_memberships row (role, org_id)
    this.refreshToken = null;
    this._refreshTimer = null;
  }

  /** @returns {boolean} */
  isLoggedIn() { return !!this.user; }

  /**
   * Login with email/password.
   * On success: stores tokens, fetches profile + org, starts auto-refresh.
   */
  async login(email, password) { /* ... */ }

  /**
   * Try auto-login from a cached refresh token (silent, no-throw).
   * Called on server startup. Returns true if successful.
   */
  async tryAutoLogin() { /* ... */ }

  /**
   * Refresh the access token using the stored refresh token.
   * Called automatically before expiry.
   */
  async refresh() { /* ... */ }

  /**
   * Logout: clear tokens, stop refresh timer, emit event.
   */
  async logout() { /* ... */ }

  /**
   * Fetch the user's profile and org membership after auth.
   * Populates this.profile, this.org, this.membership.
   */
  async _fetchUserContext() { /* ... */ }

  /**
   * Schedule automatic token refresh 60s before expiry.
   */
  _scheduleRefresh(expiresIn) { /* ... */ }

  /**
   * Cache refresh token in SecretsManager vault.
   */
  async _cacheRefreshToken(token) { /* ... */ }

  /**
   * Load cached refresh token from SecretsManager vault.
   */
  async _loadCachedRefreshToken() { /* ... */ }

  /**
   * Clear cached refresh token.
   */
  async _clearCachedRefreshToken() { /* ... */ }

  /**
   * Get auth snapshot for status reporting.
   */
  getSnapshot() {
    return {
      loggedIn: this.isLoggedIn(),
      user: this.user ? { id: this.user.id, email: this.user.email } : null,
      profile: this.profile ? { displayName: this.profile.display_name, avatarUrl: this.profile.avatar_url } : null,
      org: this.org ? { id: this.org.id, name: this.org.name, slug: this.org.slug, tier: this.org.subscription_tier } : null,
      role: this.membership?.role || null,
    };
  }
}
```

### 4.5 `CloudWorkspaceSync` — Workspace State Sync

```javascript
// src/cloud/cloud-workspace-sync.mjs

/**
 * Handles bidirectional sync of workspace state between the local
 * WorkspaceManager and the cloud workspaces table.
 *
 * Sync model: "last-write-wins" with timestamps.
 * The cloud workspace row stores the same fields as the local workspace:
 *   task_goal, current_step, status, progress_data, next_steps, shared_memory
 *
 * Emits events:
 *   cloud:workspace:linked    { localDir, cloudWorkspaceId }
 *   cloud:workspace:unlinked  {}
 *   cloud:workspace:pushed    { workspaceId }
 *   cloud:workspace:pulled    { workspaceId, state }
 *   cloud:workspace:conflict  { field, localValue, cloudValue }
 */
export class CloudWorkspaceSync {
  /**
   * @param {CloudClient} client
   * @param {AiManEventBus} eventBus
   */
  constructor(client, eventBus) { /* ... */ }

  /**
   * Link the current local workspace to a cloud workspace.
   * Creates a `.cloud-link.json` file in the workspace root.
   */
  async link(localDir, cloudWorkspaceId) { /* ... */ }

  /**
   * Unlink — remove the cloud association.
   */
  async unlink(localDir) { /* ... */ }

  /**
   * Load link info from `.cloud-link.json` if it exists.
   */
  async loadLink(localDir) { /* ... */ }

  /**
   * Push local workspace state to cloud.
   * @param {object} localState — from WorkspaceManager.getWorkspaceContext()
   */
  async push(cloudWorkspaceId, localState) { /* ... */ }

  /**
   * Pull cloud workspace state.
   * @returns {object|null} Cloud workspace state
   */
  async pull(cloudWorkspaceId) { /* ... */ }

  /**
   * List available cloud workspaces for the current org.
   */
  async listCloudWorkspaces(orgId) { /* ... */ }
}
```

### 4.6 `CloudConversationSync` — Conversation & Message Sync

```javascript
// src/cloud/cloud-conversation-sync.mjs

/**
 * Syncs conversations and messages between local ConversationManager
 * and cloud conversations/messages tables.
 *
 * Local conversations are JSON files keyed by name (e.g., "chat", "research").
 * Cloud conversations are keyed by UUID.
 * The mapping is stored in `.cloud-link.json` alongside workspace link.
 *
 * Sync model: append-only for messages. New local messages are pushed
 * to the cloud. New cloud messages (from team members or agents) are
 * pulled and appended to local history.
 */
export class CloudConversationSync {
  /**
   * @param {CloudClient} client
   * @param {AiManEventBus} eventBus
   */
  constructor(client, eventBus) { /* ... */ }

  /**
   * Link a local conversation name to a cloud conversation UUID.
   */
  async linkConversation(localName, cloudConvId) { /* ... */ }

  /**
   * Push new messages from a local conversation to cloud.
   * Only pushes messages not yet synced (tracked by last sync timestamp).
   */
  async pushMessages(cloudConvId, messages) { /* ... */ }

  /**
   * Pull new messages from cloud conversation.
   * Returns messages created after the last sync timestamp.
   */
  async pullMessages(cloudConvId, since) { /* ... */ }

  /**
   * List conversations for a cloud workspace.
   */
  async listCloudConversations(cloudWorkspaceId) { /* ... */ }

  /**
   * Create a new conversation in the cloud workspace.
   */
  async createCloudConversation(cloudWorkspaceId, name, type) { /* ... */ }
}
```

### 4.7 `CloudAgent` — Cloud Agent Invocation

```javascript
// src/cloud/cloud-agent.mjs

/**
 * Handles invocation of cloud AI agents via the agent-chat Edge Function.
 *
 * Cloud agents are AI entities configured in the cloud dashboard with
 * custom personas, system prompts, and model configs. They are invoked
 * by slug name and respond within a cloud conversation.
 */
export class CloudAgent {
  /**
   * @param {CloudClient} client
   * @param {AiManEventBus} eventBus
   */
  constructor(client, eventBus) { /* ... */ }

  /**
   * List available cloud agents for the current org.
   */
  async listAgents(orgId) { /* ... */ }

  /**
   * Invoke a cloud agent with a message.
   * @param {string} agentSlug
   * @param {string} conversationId — cloud conversation UUID
   * @param {string} message
   * @param {Array} messageHistory — recent messages for context
   * @returns {{ content: string, messageId: string, agentName: string }}
   */
  async invoke(agentSlug, conversationId, message, messageHistory) { /* ... */ }
}
```

### 4.8 `CloudSync` — Main Orchestrator

```javascript
// src/cloud/cloud-sync.mjs

/**
 * CloudSync is the top-level orchestrator that ties together all cloud
 * sub-modules. It is the single service registered into ServiceRegistry
 * as 'cloudSync'.
 *
 * Lifecycle:
 *   1. initialize(config) — creates CloudClient, CloudAuth
 *   2. login(email, password) — authenticates, creates sub-modules
 *   3. linkWorkspace(wsId) — links local workspace to cloud
 *   4. pushState() / pullState() — manual or auto sync
 *   5. logout() — tears down all cloud connections
 *   6. destroy() — cleanup on server shutdown
 *
 * All methods are safe to call even when not logged in — they return
 * early with sensible defaults (null, empty arrays, false).
 */
export class CloudSync {
  /**
   * @param {AiManEventBus} eventBus
   * @param {SecretsManager} secretsManager
   */
  constructor(eventBus, secretsManager) {
    this.eventBus = eventBus;
    this.secretsManager = secretsManager;

    // Sub-modules (created lazily on login)
    this.client = null;         // CloudClient
    this.auth = null;           // CloudAuth
    this.workspaceSync = null;  // CloudWorkspaceSync
    this.conversationSync = null; // CloudConversationSync
    this.agent = null;          // CloudAgent
    // this.realtime = null;    // CloudRealtime (Phase 4)

    this._config = null;
    this._syncTimer = null;
    this._presenceTimer = null;
    this._linkedWorkspaceId = null;
  }

  // ── Lifecycle ──

  async initialize(config) { /* Create client + auth */ }
  async login(email, password) { /* Auth + create sub-modules + auto-link */ }
  async tryAutoLogin() { /* Silent auto-login from cached token */ }
  async logout() { /* Tear down sub-modules + clear timers */ }
  async destroy() { /* Full cleanup on server shutdown */ }

  // ── Status ──

  isConfigured() { return !!this._config; }
  isLoggedIn() { return this.auth?.isLoggedIn() || false; }
  getStatus() { /* Full status snapshot */ }

  // ── Workspace Sync ──

  async linkWorkspace(cloudWorkspaceId) { /* ... */ }
  async unlinkWorkspace() { /* ... */ }
  async pushWorkspaceState(localState) { /* ... */ }
  async pullWorkspaceState() { /* ... */ }
  async listCloudWorkspaces() { /* ... */ }

  // ── Conversation Sync ──

  async pushConversation(localName, messages) { /* ... */ }
  async pullConversation(localName) { /* ... */ }

  // ── Cloud Agents ──

  async listAgents() { /* ... */ }
  async invokeAgent(slug, message, history) { /* ... */ }

  // ── AI Proxy (Phase 3) ──

  async aiProxyRequest(provider, model, messages, stream) { /* ... */ }

  // ── Auto-sync Timer ──

  _startAutoSync() { /* ... */ }
  _stopAutoSync() { /* ... */ }
}
```

### 4.9 Module Dependency Graph

```
CloudSync (orchestrator)
├── CloudClient (REST, zero deps)
├── CloudAuth (login/logout/refresh)
│   ├── CloudClient
│   └── SecretsManager (existing — token caching)
├── CloudWorkspaceSync (push/pull workspace state)
│   └── CloudClient
├── CloudConversationSync (push/pull messages)
│   └── CloudClient
├── CloudAgent (invoke cloud agents)
│   └── CloudClient
└── CloudRealtime (Phase 4 — WebSocket channels)
    └── WebSocket (native or `ws` package)
```

All modules depend only on `CloudClient` for HTTP communication. No module depends on Supabase, and no module depends on another cloud module directly — they all go through the `CloudSync` orchestrator.

## 5. Wiring Into Existing Architecture

### 5.1 `main.mjs` — Conditional Initialization

The cloud module is conditionally loaded in `main.mjs` after the assistant is created, following the same pattern as OpenClaw:

```javascript
// In main.mjs, after assistant initialization and before server start:

// ── Cloud Sync (optional) ──
let cloudSync = null;
const cloudUrl = process.env.OBOTO_CLOUD_URL || secretsManager.get('OBOTO_CLOUD_URL');
const cloudKey = process.env.OBOTO_CLOUD_KEY || secretsManager.get('OBOTO_CLOUD_KEY');

if (cloudUrl && cloudKey) {
  try {
    const { CloudSync } = await import('./cloud/cloud-sync.mjs');
    const { loadCloudConfig } = await import('./cloud/cloud-config.mjs');

    const cloudConfig = loadCloudConfig();
    if (cloudConfig) {
      cloudSync = new CloudSync(eventBus, secretsManager);
      await cloudSync.initialize(cloudConfig);

      // Auto-login from cached refresh token (silent, non-blocking)
      cloudSync.tryAutoLogin().catch(err => {
        consoleStyler.log('warning', `Cloud auto-login failed: ${err.message}`);
      });

      consoleStyler.log('system', '☁️  Cloud integration initialized');
    }
  } catch (err) {
    consoleStyler.log('warning', `Cloud integration failed to initialize: ${err.message}`);
  }
}

// Register as optional service (null if not configured)
assistant._services.register('cloudSync', cloudSync);
```

Key points:
- Uses `await import()` — the `src/cloud/` directory is never statically imported
- If `OBOTO_CLOUD_URL` or `OBOTO_CLOUD_KEY` are missing, `cloudSync` stays `null`
- Auto-login is fire-and-forget — it doesn't block server startup
- Failure to initialize cloud doesn't crash the server

### 5.2 `ServiceRegistry` — Optional Service Access

The existing `ServiceRegistry` already supports optional services:

```javascript
// In any stage or handler that wants to use cloud:
const cloudSync = services.optional('cloudSync');
if (cloudSync && cloudSync.isLoggedIn()) {
  // Cloud features available
} else {
  // Cloud not configured or not logged in — skip silently
}
```

No changes needed to `ServiceRegistry`. The `optional()` method returns `null` if the service isn't registered.

### 5.3 `web-server.mjs` — Handler Registration

The cloud WS handler is registered alongside existing handlers:

```javascript
// In web-server.mjs buildDispatcher():
import { handlers as cloudHandlers } from './ws-handlers/cloud-handler.mjs';

function buildDispatcher() {
  const dispatcher = new WsDispatcher();
  // ... existing handlers ...
  dispatcher.registerAll(cloudHandlers);
  return dispatcher;
}
```

The `cloudSync` instance is passed to handlers through the existing `ctx` object:

```javascript
// In wss.on('connection') message handler:
const ctx = {
  ws,
  assistant,
  broadcast,
  eventBus,
  agentLoopController,
  schedulerService,
  secretsManager,
  activeController,
  broadcastFileTree,
  workspaceContentServer,
  cloudSync,              // NEW — may be null
};
```

### 5.4 `cloud-handler.mjs` — WS Message Handler

```javascript
// src/server/ws-handlers/cloud-handler.mjs

export const handlers = {
  // ── Auth ──
  'cloud:login': async (data, ctx) => {
    if (!ctx.cloudSync) {
      return ctx.ws.send(JSON.stringify({
        type: 'cloud:status',
        payload: { configured: false, error: 'Cloud not configured' }
      }));
    }
    try {
      await ctx.cloudSync.login(data.payload.email, data.payload.password);
      ctx.ws.send(JSON.stringify({
        type: 'cloud:login-result',
        payload: { success: true, ...ctx.cloudSync.getStatus() }
      }));
      // Broadcast to all clients that cloud state changed
      ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
    } catch (err) {
      ctx.ws.send(JSON.stringify({
        type: 'cloud:login-result',
        payload: { success: false, error: err.message }
      }));
    }
  },

  'cloud:logout': async (data, ctx) => {
    if (!ctx.cloudSync) return;
    await ctx.cloudSync.logout();
    ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
  },

  'cloud:status': async (data, ctx) => {
    ctx.ws.send(JSON.stringify({
      type: 'cloud:status',
      payload: ctx.cloudSync ? ctx.cloudSync.getStatus() : { configured: false }
    }));
  },

  // ── Workspace ──
  'cloud:list-workspaces': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    const workspaces = await ctx.cloudSync.listCloudWorkspaces();
    ctx.ws.send(JSON.stringify({
      type: 'cloud:workspaces',
      payload: workspaces
    }));
  },

  'cloud:link-workspace': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    await ctx.cloudSync.linkWorkspace(data.payload.cloudWorkspaceId);
    ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
  },

  'cloud:unlink-workspace': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    await ctx.cloudSync.unlinkWorkspace();
    ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
  },

  'cloud:sync-push': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    const state = ctx.assistant.workspaceManager.getWorkspaceContext();
    await ctx.cloudSync.pushWorkspaceState(state);
    ctx.ws.send(JSON.stringify({ type: 'cloud:sync-result', payload: { action: 'push', success: true } }));
  },

  'cloud:sync-pull': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    const state = await ctx.cloudSync.pullWorkspaceState();
    ctx.ws.send(JSON.stringify({ type: 'cloud:sync-result', payload: { action: 'pull', success: true, state } }));
  },

  // ── Agents ──
  'cloud:list-agents': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    const agents = await ctx.cloudSync.listAgents();
    ctx.ws.send(JSON.stringify({ type: 'cloud:agents', payload: agents }));
  },

  'cloud:invoke-agent': async (data, ctx) => {
    if (!ctx.cloudSync?.isLoggedIn()) return;
    const { slug, message, history } = data.payload;
    try {
      const result = await ctx.cloudSync.invokeAgent(slug, message, history || []);
      ctx.ws.send(JSON.stringify({ type: 'cloud:agent-response', payload: result }));
      // Also broadcast as a chat message so it appears in the conversation
      ctx.broadcast('message', {
        id: result.messageId || `cloud-agent-${Date.now()}`,
        role: 'ai',
        type: 'text',
        content: `☁️ **${result.agentName}**: ${result.content}`,
        timestamp: new Date().toLocaleTimeString(),
        isCloudAgent: true,
        agentName: result.agentName,
      });
    } catch (err) {
      ctx.ws.send(JSON.stringify({
        type: 'cloud:agent-error',
        payload: { error: err.message, slug }
      }));
    }
  },
};
```

### 5.5 `EventBus` — Cloud Events

The cloud module emits events through the existing `AiManEventBus`. These are relayed to WS clients in `web-server.mjs`:

```javascript
// In web-server.mjs, alongside existing eventBus listeners:
if (eventBus) {
  // ... existing listeners ...

  // Cloud Events
  eventBus.on('cloud:auth:logged-in', (data) => broadcast('cloud:status', data));
  eventBus.on('cloud:auth:logged-out', (data) => broadcast('cloud:status', data));
  eventBus.on('cloud:auth:error', (data) => broadcast('cloud:error', data));
  eventBus.on('cloud:workspace:pushed', (data) => broadcast('cloud:sync-status', { state: 'synced' }));
  eventBus.on('cloud:workspace:pulled', (data) => broadcast('cloud:sync-status', { state: 'synced' }));
  eventBus.on('cloud:workspace:conflict', (data) => broadcast('cloud:conflict', data));
}
```

### 5.6 Connection Status on Client Connect

When a new WS client connects, the server sends cloud status alongside existing connection info:

```javascript
// In wss.on('connection'), after existing status sends:
if (cloudSync) {
  try {
    ws.send(JSON.stringify({
      type: 'cloud:status',
      payload: cloudSync.getStatus()
    }));
  } catch (e) { /* ignore */ }
}
```

### 5.7 Server Shutdown

In `main.mjs`'s `finally` block:

```javascript
finally {
  if (cloudSync) {
    await cloudSync.destroy();
  }
  // ... existing cleanup ...
}
```

## 6. AI Proxy Provider Integration

### 6.1 The Opportunity

When a user is logged into Oboto Cloud, the server gains access to the `ai-proxy` Edge Function. This opens a powerful new capability: **the user can use AI models without configuring their own API keys.** The cloud proxy manages API keys at the organization level, tracks token usage, enforces rate limits, and routes to optimal models — all metered through the subscription tier.

### 6.2 Cloud as a Provider

The existing `ai-provider.mjs` supports multiple providers: `openai`, `gemini`, `anthropic`, `lmstudio`. We add `cloud` as a new provider option that routes through the cloud proxy.

The key insight is that the cloud proxy's request/response format is designed to match the OpenAI-compatible shape that `ai-provider.mjs` already expects. This means the integration is a thin adapter.

### 6.3 Integration into `ai-provider.mjs`

```javascript
// In createProviderContext() — add cloud provider detection:
if (process.env.AI_PROVIDER === 'cloud') {
  // Cloud proxy provider — requires active cloud connection
  return { provider: 'cloud', endpoint: null, model: process.env.AI_MODEL || 'auto' };
}

// In callProvider() — add cloud handler:
case 'cloud': {
  const cloudSync = services?.optional('cloudSync');
  if (!cloudSync?.isLoggedIn()) {
    throw new Error('Cloud AI proxy requires an active Oboto Cloud login');
  }
  return await cloudSync.aiProxyRequest(
    request.provider || 'auto',  // Let cloud decide optimal provider
    request.model,
    request.messages,
    false  // non-streaming
  );
}
```

### 6.4 Streaming Support

For streaming via the cloud proxy, `callProviderStream()` uses the `CloudClient.stream()` async generator:

```javascript
case 'cloud': {
  const cloudSync = services?.optional('cloudSync');
  if (!cloudSync?.isLoggedIn()) {
    throw new Error('Cloud AI proxy requires an active Oboto Cloud login');
  }
  // Returns async generator yielding SSE chunks
  return cloudSync.aiProxyStream(request.model, request.messages);
}
```

### 6.5 PromptRouter Integration

The `PromptRouter` can route specific task types to the cloud proxy while keeping others local:

```javascript
// In config.mjs routing section:
routing: {
  agentic: 'cloud',           // Use cloud proxy for agentic tasks
  reasoning_high: 'cloud',    // Complex reasoning → cloud (better models)
  reasoning_low: '',           // Simple tasks → local (fast, free)
  summarizer: '',              // Summaries → local
  code_completion: '',         // Completions → local (latency-sensitive)
}
```

This enables a **hybrid model**: fast/cheap tasks run locally with the user's own keys, while expensive reasoning tasks route through the cloud proxy where the org's premium API keys and better models are available.

### 6.6 Fallback Behavior

If the cloud proxy is unavailable (network error, rate limit exceeded, credits depleted), the system falls back to the next available local provider:

```
Cloud proxy → (fail) → Local provider (openai/gemini/anthropic/lmstudio)
```

This ensures the user is never stuck. The fallback is handled in `callProvider()`:

```javascript
case 'cloud': {
  try {
    return await cloudSync.aiProxyRequest(...);
  } catch (err) {
    consoleStyler.log('warning', `Cloud AI proxy failed: ${err.message}. Falling back to local.`);
    // Re-route to the first available local provider
    const fallbackProvider = detectLocalProvider();
    if (fallbackProvider) {
      return await callProviderDirect(fallbackProvider, request);
    }
    throw err;  // No local provider available either
  }
}
```

### 6.7 No-Key Experience

The most significant user experience improvement: a brand-new user who has **zero API keys configured** can still use Oboto if they sign up for an Oboto Cloud account (even free tier). The cloud proxy provides 50K tokens/day on the free tier — enough to get started and experience the product before committing to their own API keys.

The Setup Wizard can present this as an option:
```
"How would you like to connect to AI models?"
  ○ Use your own API keys (OpenAI, Google, Anthropic)
  ○ Use Oboto Cloud (50K free tokens/day — sign up now)
  ○ Use a local model (LMStudio, Ollama)
```

## 7. Data Sync Strategy

### 7.1 Overview

Data sync follows a **conservative, opt-in model**. Nothing syncs automatically unless the user explicitly links their local workspace to a cloud workspace.

### 7.2 Link File: `.cloud-link.json`

When a user links a local workspace to a cloud workspace, a `.cloud-link.json` file is created in the workspace root:

```json
{
  "version": 1,
  "cloudWorkspaceId": "uuid-of-cloud-workspace",
  "cloudWorkspaceName": "my-project",
  "linkedAt": "2026-02-19T23:00:00Z",
  "lastSyncAt": "2026-02-19T23:30:00Z",
  "conversations": {
    "chat": {
      "cloudConvId": "uuid-of-cloud-conversation",
      "lastSyncAt": "2026-02-19T23:30:00Z",
      "lastLocalMessageId": "msg-local-42",
      "lastCloudMessageAt": "2026-02-19T23:25:00Z"
    },
    "research": {
      "cloudConvId": "uuid-of-cloud-conversation-2",
      "lastSyncAt": "2026-02-19T23:15:00Z"
    }
  },
  "syncConfig": {
    "autoSync": true,
    "syncIntervalMs": 30000,
    "syncConversations": true,
    "syncWorkspaceState": true,
    "syncFiles": false
  }
}
```

This file should be added to `.gitignore` (it contains cloud-specific UUIDs).

### 7.3 Workspace State Sync

**What syncs:** The `workspaces` table row fields that match `WorkspaceManager` state:
- `task_goal` — current task objective
- `current_step` — what's being worked on now
- `status` — idle / in_progress / paused / completed / error
- `progress_data` — arbitrary JSON (files created, tests passed, etc.)
- `next_steps` — array of upcoming steps
- `shared_memory` — team-shared context

**Sync direction:** Bidirectional, last-write-wins.

**Push trigger:** After any `WorkspaceManager` mutation:
```javascript
// In CloudSync._startAutoSync():
this.eventBus.on('workspace:updated', debounce(async () => {
  const state = this._getWorkspaceContext();
  if (state) await this.pushWorkspaceState(state);
}, 5000));  // Debounce 5s to batch rapid changes
```

**Pull trigger:** On a configurable interval (default 30s) and on manual sync:
```javascript
// Auto-pull on interval
this._syncTimer = setInterval(async () => {
  try {
    const cloudState = await this.pullWorkspaceState();
    if (cloudState) {
      this.eventBus.emit('cloud:workspace:pulled', cloudState);
    }
  } catch (e) {
    // Log but don't throw — auto-sync failures are non-critical
  }
}, this._config.syncInterval);
```

**Conflict resolution:** Last-write-wins with timestamp comparison. If cloud `updated_at` is newer than local `lastSyncAt`, the cloud version wins. If local changes happened after `lastSyncAt`, local wins. True conflicts (both changed) are reported to the user via `cloud:workspace:conflict` event and the cloud version is preserved (local can be recovered from the event payload).

### 7.4 Conversation / Message Sync

**Model:** Append-only. Messages are immutable once created. Sync tracks the high-water mark (last synced timestamp or message ID) in each direction.

**Push flow:**
1. Get all messages from local `HistoryManager.getHistory()`
2. Filter to messages created after `lastSyncAt` (tracked in `.cloud-link.json`)
3. Map local message format (`{ role, content, tool_calls, name }`) to cloud format (`{ conversation_id, content, role, sender_user_id }`)
4. POST each new message to the cloud `/rest/v1/messages` endpoint
5. Update `lastSyncAt` in `.cloud-link.json`

**Pull flow:**
1. GET messages from cloud where `created_at > lastCloudMessageAt`
2. Filter out messages we sent ourselves (by `sender_user_id`)
3. Append new messages from team members or agents to local history
4. Update `lastCloudMessageAt` in `.cloud-link.json`

**Message deduplication:** Each local message gets a deterministic ID based on `role + content hash + timestamp`. When pushing, we skip messages whose hash already exists in the cloud. This prevents duplicates on re-sync.

**System messages:** Local system messages (system prompts, internal orchestration messages) are **not synced** to the cloud. Only `user` and `assistant` role messages are pushed.

### 7.5 File Sync (Future — Phase 5)

File sync is not included in the initial phases. When implemented:

- **Selective sync:** Only files explicitly marked for sharing are synced (not the entire workspace)
- **Checksum-based:** SHA-256 checksums are compared to detect changes
- **Conflict handling:** Modified files get a `.conflict` suffix for manual resolution
- **Size limits:** Files over 10MB are excluded by default
- **Ignore patterns:** Respects `.gitignore` patterns

### 7.6 Offline Behavior

When the cloud is unreachable:
1. All local features continue working normally
2. Sync timers keep ticking but silently fail
3. Changes accumulate locally
4. On reconnection, a full sync push/pull catches up
5. The UI shows `cloud:sync-status: { state: 'offline' }` — CloudSyncIndicator shows a grey icon

### 7.7 Data That Never Syncs

These stay local-only by design:

| Data | Reason |
|------|--------|
| Agent loop state | Local execution context |
| Scheduler/task state | Local execution context |
| Tool execution results | Security — never expose local file ops to cloud |
| MCP client configs | Local service connections |
| Secrets vault | Security — API keys stay local |
| OpenClaw state | Local integration |
| Consciousness processor state | Synced separately via cloud agent consciousness, not via workspace sync |
| System prompt content | Contains local paths and security-sensitive context |

## 8. Realtime Protocol

### 8.1 Phased Approach

Realtime is split into two tiers:

| Tier | Mechanism | Phase | What It Enables |
|------|-----------|-------|-----------------|
| **Polling** | Periodic REST calls (every 30s) | Phase 2 | Workspace state sync, new messages from team |
| **WebSocket** | Phoenix Channel protocol | Phase 4 | Sub-second presence, typing indicators, live messages |

Phase 1–3 use polling only. This is simpler, works reliably through proxies/firewalls, and requires zero new protocol knowledge. Phase 4 upgrades to full WebSocket realtime for a polished collaborative experience.

### 8.2 Polling-Based Realtime (Phases 1–3)

The `CloudSync._startAutoSync()` method runs two polling loops:

```javascript
_startAutoSync() {
  // Workspace state sync — every 30s
  this._syncTimer = setInterval(async () => {
    try {
      await this._syncWorkspaceState();
    } catch (e) {
      this.eventBus.emitTyped('cloud:sync-status', { state: 'error', error: e.message });
    }
  }, this._config.syncInterval);

  // Presence heartbeat — every 60s
  this._presenceTimer = setInterval(async () => {
    try {
      await this._updatePresence();
      await this._fetchOnlineMembers();
    } catch (e) { /* silent */ }
  }, this._config.presenceInterval);
}
```

**Presence via polling:** The server PATCHes its own `workspace_members.last_seen_at` every 60s. Members with `last_seen_at` within the last 5 minutes are considered "online". This is coarse-grained but functional.

### 8.3 WebSocket Realtime (Phase 4)

Supabase Realtime uses the **Phoenix Channel protocol** over WebSocket. The wire format is:

```javascript
// Connection
WSS {CLOUD_URL}/realtime/v1/websocket?apikey={anonKey}&vsn=1.0.0

// Join a channel (after auth)
→ { topic: "realtime:public:messages", event: "phx_join", payload: { config: { postgres_changes: [...] } }, ref: "1" }
← { topic: "realtime:public:messages", event: "phx_reply", payload: { status: "ok" }, ref: "1" }

// Incoming database change
← { topic: "realtime:public:messages", event: "postgres_changes", payload: { data: { type: "INSERT", record: { ... } } } }

// Heartbeat (every 30s)
→ { topic: "phoenix", event: "heartbeat", payload: {}, ref: "2" }
← { topic: "phoenix", event: "phx_reply", payload: { status: "ok" }, ref: "2" }
```

### 8.4 `CloudRealtime` Module (Phase 4)

```javascript
// src/cloud/cloud-realtime.mjs
import WebSocket from 'ws';

export class CloudRealtime {
  constructor(cloudUrl, anonKey, accessToken, eventBus) {
    this.ws = null;
    this.cloudUrl = cloudUrl;
    this.anonKey = anonKey;
    this.accessToken = accessToken;
    this.eventBus = eventBus;
    this._heartbeatTimer = null;
    this._ref = 0;
    this._channels = new Map();
  }

  async connect() {
    const url = `${this.cloudUrl.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${this.anonKey}&vsn=1.0.0`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this._authenticate();
      this._startHeartbeat();
    });

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this._handleMessage(msg);
    });

    this.ws.on('close', () => {
      this._stopHeartbeat();
      // Auto-reconnect with backoff
    });
  }

  // Subscribe to new messages in a conversation
  subscribeToMessages(conversationIds) { /* ... */ }

  // Subscribe to workspace state changes
  subscribeToWorkspace(workspaceId) { /* ... */ }

  // Join presence channel
  joinPresence(workspaceId, userInfo) { /* ... */ }

  // Broadcast ephemeral event (typing, cursor)
  broadcast(workspaceId, event, payload) { /* ... */ }

  disconnect() { /* ... */ }
}
```

### 8.5 What Realtime Enables (Phase 4)

| Feature | Channel Type | Description |
|---------|-------------|-------------|
| Live messages | Postgres Changes on `messages` table | New messages from team members appear instantly |
| Workspace updates | Postgres Changes on `workspaces` table | Task progress changes from other users |
| Presence | Presence channel per workspace | Who's online, their status, current file |
| Typing indicators | Broadcast on workspace channel | Ephemeral "Alice is typing..." events |
| Agent activity | Postgres Changes on `cloud_agents` table | Agent status changes (idle → active) |

## 9. UI Integration

### 9.1 Design Principle

The UI knows **nothing** about Supabase, REST APIs, or cloud protocols. It only knows about WS message types. Cloud features appear as additional UI elements that render based on state received from the local WS connection.

### 9.2 WS Message Types (Client ← Server)

These are the messages the UI listens for:

| Type | Payload | Description |
|------|---------|-------------|
| `cloud:status` | `{ configured, loggedIn, user, profile, org, linkedWorkspace, syncState }` | Full cloud state snapshot |
| `cloud:login-result` | `{ success, error?, ...status }` | Response to login attempt |
| `cloud:workspaces` | `[{ id, name, slug, status }]` | List of cloud workspaces |
| `cloud:agents` | `[{ id, name, slug, type, status, avatarUrl }]` | List of cloud agents |
| `cloud:agent-response` | `{ content, agentName, messageId }` | Cloud agent reply |
| `cloud:agent-error` | `{ error, slug }` | Cloud agent invocation failure |
| `cloud:sync-status` | `{ state: 'synced'\|'syncing'\|'offline'\|'error' }` | Sync state change |
| `cloud:sync-result` | `{ action, success, state? }` | Result of manual sync push/pull |
| `cloud:presence` | `[{ userId, displayName, avatarUrl, status, lastSeen }]` | Online members |
| `cloud:conflict` | `{ field, localValue, cloudValue }` | Sync conflict notification |
| `cloud:error` | `{ error }` | Cloud error notification |

### 9.3 WS Message Types (Client → Server)

| Type | Payload | Description |
|------|---------|-------------|
| `cloud:login` | `{ email, password }` | Login request |
| `cloud:logout` | `{}` | Logout request |
| `cloud:status` | `{}` | Request current status |
| `cloud:list-workspaces` | `{}` | List cloud workspaces |
| `cloud:link-workspace` | `{ cloudWorkspaceId }` | Link local workspace to cloud |
| `cloud:unlink-workspace` | `{}` | Unlink workspace |
| `cloud:sync-push` | `{}` | Manual push |
| `cloud:sync-pull` | `{}` | Manual pull |
| `cloud:list-agents` | `{}` | List available agents |
| `cloud:invoke-agent` | `{ slug, message, history? }` | Invoke a cloud agent |

### 9.4 `wsService.ts` Additions

```typescript
// Cloud methods added to WSService class:

cloudLogin(email: string, password: string) {
  this.sendMessage('cloud:login', { email, password });
}

cloudLogout() {
  this.sendMessage('cloud:logout');
}

cloudGetStatus() {
  this.sendMessage('cloud:status');
}

cloudListWorkspaces() {
  this.sendMessage('cloud:list-workspaces');
}

cloudLinkWorkspace(cloudWorkspaceId: string) {
  this.sendMessage('cloud:link-workspace', { cloudWorkspaceId });
}

cloudUnlinkWorkspace() {
  this.sendMessage('cloud:unlink-workspace');
}

cloudSyncPush() {
  this.sendMessage('cloud:sync-push');
}

cloudSyncPull() {
  this.sendMessage('cloud:sync-pull');
}

cloudListAgents() {
  this.sendMessage('cloud:list-agents');
}

cloudInvokeAgent(slug: string, message: string, history?: unknown[]) {
  this.sendMessage('cloud:invoke-agent', { slug, message, history });
}
```

### 9.5 `useCloudSync.ts` Hook

```typescript
// ui/src/hooks/useCloudSync.ts

interface CloudState {
  configured: boolean;
  loggedIn: boolean;
  user: { id: string; email: string } | null;
  profile: { displayName: string; avatarUrl: string | null } | null;
  org: { id: string; name: string; slug: string; tier: string } | null;
  role: string | null;
  linkedWorkspace: { id: string; name: string } | null;
  syncState: 'synced' | 'syncing' | 'offline' | 'error' | 'idle';
  agents: CloudAgent[];
  workspaces: CloudWorkspace[];
  onlineMembers: OnlineMember[];
}

export function useCloudSync() {
  const [state, setState] = useState<CloudState>(defaultState);

  useEffect(() => {
    // Listen for cloud:status events
    const unsub1 = wsService.on('cloud:status', (payload) => {
      setState(prev => ({ ...prev, ...payload }));
    });
    // Listen for cloud:agents
    const unsub2 = wsService.on('cloud:agents', (payload) => {
      setState(prev => ({ ...prev, agents: payload }));
    });
    // ... other listeners ...

    // Request initial status
    wsService.cloudGetStatus();

    return () => { unsub1(); unsub2(); /* ... */ };
  }, []);

  return {
    ...state,
    login: wsService.cloudLogin.bind(wsService),
    logout: wsService.cloudLogout.bind(wsService),
    linkWorkspace: wsService.cloudLinkWorkspace.bind(wsService),
    unlinkWorkspace: wsService.cloudUnlinkWorkspace.bind(wsService),
    syncPush: wsService.cloudSyncPush.bind(wsService),
    syncPull: wsService.cloudSyncPull.bind(wsService),
    listAgents: wsService.cloudListAgents.bind(wsService),
    invokeAgent: wsService.cloudInvokeAgent.bind(wsService),
  };
}
```

### 9.6 UI Components

#### `CloudAccountPanel` (Settings Dialog)

Shown as a new tab in the Settings dialog. Provides:
- **Not configured state:** Instructions on setting `OBOTO_CLOUD_URL` and `OBOTO_CLOUD_KEY`
- **Not logged in state:** Email/password login form with "Sign up" link to cloud dashboard
- **Logged in state:** User profile card (avatar, name, email), org info (name, tier), logout button
- **Workspace linking:** Dropdown to select a cloud workspace to link to the current local workspace, with link/unlink button

#### `CloudSyncIndicator` (StatusBar)

A small icon in the status bar that shows sync state:
- ☁️ (blue) — synced
- 🔄 (spinning) — syncing
- ⚪ (grey) — offline / not connected
- 🔴 (red) — sync error
- Hidden entirely when cloud is not configured

Clicking the indicator opens a popover with sync details and manual push/pull buttons.

#### `CloudPresenceBar` (Header or Sidebar)

Shows colored avatar circles of online team members. Only visible when cloud is connected and a workspace is linked. Hovering shows the member's name and what they're working on.

#### `settings/CloudSettings.tsx`

Dedicated settings panel for cloud configuration:
- Cloud URL and API key fields (read from env, editable via secrets vault)
- Auto-sync toggle and interval setting
- Conversation sync toggle
- Workspace state sync toggle
- AI proxy toggle (use cloud for AI instead of local keys)
- Current usage stats (if available from cloud)

## 10. Configuration

### 10.1 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OBOTO_CLOUD_URL` | Yes (for cloud) | — | Cloud backend base URL (e.g. `https://xyz.supabase.co`) |
| `OBOTO_CLOUD_KEY` | Yes (for cloud) | — | Public anon API key for the cloud backend |
| `OBOTO_CLOUD_AUTO_LOGIN` | No | `true` | Auto-login from cached refresh token on startup |
| `OBOTO_CLOUD_SYNC_INTERVAL` | No | `30000` | Workspace state sync interval in ms |
| `OBOTO_CLOUD_PRESENCE_INTERVAL` | No | `60000` | Presence heartbeat interval in ms |

### 10.2 `.env.example` Additions

```env
# ── Oboto Cloud (optional) ──
# Sign up at https://oboto.ai to get your cloud credentials.
# Leave blank to run Oboto in standalone mode (no cloud features).
# OBOTO_CLOUD_URL=https://your-project.supabase.co
# OBOTO_CLOUD_KEY=your-anon-key

# Cloud sync settings (optional — these have sensible defaults)
# OBOTO_CLOUD_AUTO_LOGIN=true
# OBOTO_CLOUD_SYNC_INTERVAL=30000
# OBOTO_CLOUD_PRESENCE_INTERVAL=60000
```

### 10.3 SecretsManager Integration

Cloud credentials can also be stored in the existing secrets vault (`.ai-man/secrets.json`). This allows users to configure cloud access without exposing credentials in `.env` files (useful when the workspace is a git repo).

The initialization code checks both sources:
```javascript
const cloudUrl = process.env.OBOTO_CLOUD_URL || secretsManager.get('OBOTO_CLOUD_URL');
const cloudKey = process.env.OBOTO_CLOUD_KEY || secretsManager.get('OBOTO_CLOUD_KEY');
```

The cached refresh token is stored exclusively in SecretsManager under the key `OBOTO_CLOUD_REFRESH_TOKEN`.

### 10.4 `.cloud-link.json` (Per-Workspace)

Created in the workspace root when a local workspace is linked to a cloud workspace. See [Section 7.2](#72-link-file-cloud-linkjson) for the full schema.

This file should be added to `.gitignore`:
```
# Oboto cloud workspace link (contains cloud-specific UUIDs)
.cloud-link.json
```

### 10.5 Runtime Configuration via Settings UI

Users can also configure cloud settings through the Settings dialog in the UI (see `CloudSettings.tsx`). Changes made through the UI are persisted to the SecretsManager vault via the existing `secrets-handler.mjs` WS handler.

### 10.6 Configuration Precedence

```
1. Environment variables (.env or shell)     ← highest priority
2. SecretsManager vault (.ai-man/secrets.json)
3. Default values                            ← lowest priority
```

## 11. Implementation Phases

### Phase 1: Cloud Client + Auth (Foundation)

**Goal:** A user can log into their Oboto Cloud account from the desktop app and see their profile/org info.

**Files created:**
- `src/cloud/cloud-config.mjs`
- `src/cloud/cloud-client.mjs`
- `src/cloud/cloud-auth.mjs`
- `src/cloud/cloud-sync.mjs` (skeleton)
- `src/server/ws-handlers/cloud-handler.mjs` (login/logout/status only)

**Files modified:**
- `src/main.mjs` — conditional cloud init + service registration
- `src/server/web-server.mjs` — register cloud handler, pass cloudSync to ctx, send cloud status on connect
- `.env.example` — add cloud env vars

**UI created:**
- `ui/src/hooks/useCloudSync.ts`
- `ui/src/components/features/settings/CloudSettings.tsx` (login form + profile display)

**UI modified:**
- `ui/src/services/wsService.ts` — add cloud methods
- `ui/src/components/features/SettingsDialog.tsx` — add Cloud tab

**Deliverable:** User clicks "Cloud" tab in settings, enters email/password, logs in, sees their profile and org info. Cloud status appears in the status bar. Login persists across server restarts via cached refresh token.

**Estimated effort:** 2-3 days

---

### Phase 2: Workspace + Conversation Sync

**Goal:** User can link their local workspace to a cloud workspace and sync state bidirectionally.

**Files created:**
- `src/cloud/cloud-workspace-sync.mjs`
- `src/cloud/cloud-conversation-sync.mjs`
- `ui/src/components/features/CloudSyncIndicator.tsx`

**Files modified:**
- `src/cloud/cloud-sync.mjs` — add workspace + conversation sync, auto-sync timers
- `src/server/ws-handlers/cloud-handler.mjs` — add workspace listing, linking, sync push/pull handlers
- `ui/src/services/wsService.ts` — add workspace link/sync methods
- `ui/src/components/layout/StatusBar.tsx` — add CloudSyncIndicator

**Deliverable:** User links their local workspace to a cloud workspace. Workspace state (task, progress, steps) syncs every 30s. Conversations sync messages bidirectionally. Messages from team members or cloud agents appear in local history. Sync indicator shows current state.

**Estimated effort:** 3-4 days

**Depends on:** Phase 1

---

### Phase 3: Cloud Agents + AI Proxy

**Goal:** User can invoke cloud AI agents from the desktop app. User can route AI requests through the cloud proxy.

**Files created:**
- `src/cloud/cloud-agent.mjs`

**Files modified:**
- `src/cloud/cloud-sync.mjs` — add agent listing, invocation, AI proxy methods
- `src/server/ws-handlers/cloud-handler.mjs` — add agent list/invoke handlers
- `src/core/ai-provider.mjs` — add `cloud` provider case in callProvider/callProviderStream
- `src/config.mjs` — document `cloud` as a valid AI_PROVIDER value
- `ui/src/services/wsService.ts` — add agent methods
- `ui/src/hooks/useCloudSync.ts` — expose agents state + actions
- `ui/src/components/features/settings/CloudSettings.tsx` — add AI proxy toggle

**Deliverable:** User can list cloud agents available in their org, invoke them via the chat or settings UI, and see their responses. User can toggle AI routing to use the cloud proxy instead of local API keys.

**Estimated effort:** 2-3 days

**Depends on:** Phase 1 (Phase 2 optional — agents work without workspace linking)

---

### Phase 4: Realtime + Presence

**Goal:** Sub-second collaborative experience — live presence, instant messages, typing indicators.

**Files created:**
- `src/cloud/cloud-realtime.mjs`
- `ui/src/components/features/CloudPresenceBar.tsx`

**Files modified:**
- `src/cloud/cloud-sync.mjs` — integrate CloudRealtime, replace polling with WebSocket where possible
- `src/server/ws-handlers/cloud-handler.mjs` — add presence handlers
- `ui/src/hooks/useCloudSync.ts` — expose presence state
- `ui/src/components/layout/Header.tsx` or `Sidebar.tsx` — add CloudPresenceBar

**Deliverable:** Online team members appear as avatar bubbles in the UI. New messages from team members appear instantly (not on 30s poll). Typing indicators show when someone is composing a message.

**Estimated effort:** 3-4 days

**Depends on:** Phase 2

---

### Phase 5: File Sync + Polish (Future)

**Goal:** Selective file synchronization between local workspace and cloud storage.

**Scope:**
- File sync via Supabase Storage REST API
- Checksum-based change detection
- Conflict resolution with `.conflict` files
- `.gitignore`-aware exclusion
- Cloud file browser in the UI

**Depends on:** Phase 2

---

### Phase Summary

```
Phase 1: Auth + Client          (2-3 days)  — Foundation
Phase 2: Workspace + Conv Sync  (3-4 days)  — Core sync
Phase 3: Agents + AI Proxy      (2-3 days)  — Cloud AI
Phase 4: Realtime + Presence    (3-4 days)  — Live collab
Phase 5: File Sync              (3-4 days)  — Future

Total estimated: ~15-18 days for Phases 1-4
```

### Dependency Graph

```
Phase 1 (Auth)
├── Phase 2 (Workspace Sync)
│   ├── Phase 4 (Realtime)
│   └── Phase 5 (File Sync)
└── Phase 3 (Agents + AI Proxy)
```

Phases 2 and 3 can be developed in parallel after Phase 1.

---

*This document is the authoritative design specification for cloud integration in the ai-man desktop client.*
