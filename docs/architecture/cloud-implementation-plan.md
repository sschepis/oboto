# Oboto Cloud Integration — Implementation Plan

> Derived from [cloud-integration-design.md](./cloud-integration-design.md)

## Dependency Graph

```
Phase 1: Auth + Client Foundation
├── Phase 2: Workspace + Conversation Sync
│   ├── Phase 4: Realtime + Presence
│   └── Phase 5: File Sync (future)
└── Phase 3: Cloud Agents + AI Proxy
```

Phases 2 and 3 can be developed in parallel after Phase 1 is complete.

---

## Phase 1: Cloud Client + Auth Foundation

**Goal:** User can log into Oboto Cloud from the desktop app and see their profile/org.

**Estimated effort:** 2–3 days

### Step 1.1 — `src/cloud/cloud-config.mjs`

Create the configuration loader.

```javascript
// Reads OBOTO_CLOUD_URL and OBOTO_CLOUD_KEY from env.
// Returns null if either is missing.
// Exports: loadCloudConfig()
```

**Acceptance:** `loadCloudConfig()` returns config object or null.

### Step 1.2 — `src/cloud/cloud-client.mjs`

Create the zero-dependency REST client.

**Methods to implement:**
- `constructor(baseUrl, anonKey)`
- `setAccessToken(token)`
- `request(path, options)` — core fetch wrapper with apikey + auth headers
- `get(path, headers)`
- `post(path, body, headers)`
- `patch(path, body, headers)` — includes `Prefer: return=representation`
- `delete(path, headers)`
- `async *stream(path, body)` — SSE async generator

**Acceptance:** Can make authenticated REST calls to any URL. Unit testable with mocked fetch.

### Step 1.3 — `src/cloud/cloud-auth.mjs`

Create the auth lifecycle manager.

**Methods to implement:**
- `constructor(client, eventBus, secretsManager)`
- `login(email, password)` — POST to `/auth/v1/token?grant_type=password`, store tokens, call `_fetchUserContext()`, start refresh timer, cache token, emit `cloud:auth:logged-in`
- `tryAutoLogin()` — load cached refresh token from SecretsManager, call `refresh()`, silent no-throw
- `refresh()` — POST to `/auth/v1/token?grant_type=refresh_token`, update access token, reschedule
- `logout()` — POST to `/auth/v1/logout`, clear tokens, stop timer, clear cache, emit `cloud:auth:logged-out`
- `_fetchUserContext()` — GET profile + org_memberships, populate `this.profile`, `this.org`, `this.membership`
- `_scheduleRefresh(expiresIn)` — setTimeout for (expiresIn - 60) seconds
- `_cacheRefreshToken(token)` — `secretsManager.set('OBOTO_CLOUD_REFRESH_TOKEN', token)`
- `_loadCachedRefreshToken()` — `secretsManager.get('OBOTO_CLOUD_REFRESH_TOKEN')`
- `_clearCachedRefreshToken()` — `secretsManager.delete('OBOTO_CLOUD_REFRESH_TOKEN')`
- `isLoggedIn()` — returns `!!this.user`
- `getSnapshot()` — returns `{ loggedIn, user, profile, org, role }`

**Acceptance:** Login with valid credentials succeeds, profile/org are populated. Auto-login works after server restart.

### Step 1.4 — `src/cloud/cloud-sync.mjs` (skeleton)

Create the orchestrator skeleton. Only auth-related lifecycle for now.

**Methods to implement (Phase 1 only):**
- `constructor(eventBus, secretsManager)`
- `initialize(config)` — creates `CloudClient` and `CloudAuth`
- `login(email, password)` — delegates to `this.auth.login()`
- `tryAutoLogin()` — delegates to `this.auth.tryAutoLogin()`
- `logout()` — delegates to `this.auth.logout()`
- `destroy()` — logout + cleanup
- `isConfigured()` — `!!this._config`
- `isLoggedIn()` — `this.auth?.isLoggedIn() || false`
- `getStatus()` — returns `{ configured: true, ...this.auth.getSnapshot(), linkedWorkspace: null, syncState: 'idle' }`

**Acceptance:** CloudSync initializes, login/logout works, getStatus returns correct state.

### Step 1.5 — `src/server/ws-handlers/cloud-handler.mjs`

Create the WS message handler for cloud operations.

**Handlers to implement (Phase 1 only):**
- `cloud:login` — call `ctx.cloudSync.login()`, send `cloud:login-result`, broadcast `cloud:status`
- `cloud:logout` — call `ctx.cloudSync.logout()`, broadcast `cloud:status`
- `cloud:status` — send `cloud:status` with `ctx.cloudSync.getStatus()` or `{ configured: false }`

**Acceptance:** UI can send login/logout/status messages and receive correct responses.

### Step 1.6 — Wire into `src/main.mjs`

Modify `main.mjs` to conditionally initialize cloud.

**Changes:**
1. After `assistant` creation, check for `OBOTO_CLOUD_URL` / `OBOTO_CLOUD_KEY` (from env or secretsManager)
2. Dynamic import `src/cloud/cloud-sync.mjs` and `src/cloud/cloud-config.mjs`
3. Create `CloudSync`, call `initialize()`, call `tryAutoLogin()` (fire-and-forget)
4. Register `cloudSync` (or null) into `assistant._services`
5. Pass `cloudSync` to `startServer()` as new parameter
6. Add `cloudSync.destroy()` to `finally` block

**Acceptance:** Server starts with cloud module when env vars set. Server starts without cloud when env vars missing. No crashes either way.

### Step 1.7 — Wire into `src/server/web-server.mjs`

Modify web-server to integrate cloud handler.

**Changes:**
1. Import `cloudHandlers` from `./ws-handlers/cloud-handler.mjs`
2. Register in `buildDispatcher()`
3. Add `cloudSync` parameter to `startServer()` function signature
4. Add `cloudSync` to the `ctx` object in the WS connection handler
5. Send `cloud:status` to newly connected clients (alongside existing status sends)
6. Add cloud event listeners to eventBus (`cloud:auth:logged-in`, `cloud:auth:logged-out`, `cloud:auth:error`)

**Acceptance:** New WS clients receive cloud status on connect. Cloud handler messages are dispatched correctly.

### Step 1.8 — Update `.env.example`

Add cloud env var documentation.

### Step 1.9 — `ui/src/services/wsService.ts` additions

Add cloud methods to WSService class.

**Methods to add:**
- `cloudLogin(email, password)`
- `cloudLogout()`
- `cloudGetStatus()`

**Acceptance:** UI can call these methods and they send correct WS messages.

### Step 1.10 — `ui/src/hooks/useCloudSync.ts`

Create React hook for cloud state.

**State shape:** `{ configured, loggedIn, user, profile, org, role, syncState }`

**Listeners:** `cloud:status`, `cloud:login-result`, `cloud:error`

**Actions exposed:** `login`, `logout`

**Acceptance:** Hook correctly tracks cloud state from WS events.

### Step 1.11 — `ui/src/components/features/settings/CloudSettings.tsx`

Create the Cloud tab for the Settings dialog.

**States:**
- Not configured → show instructions
- Not logged in → show login form (email + password)
- Logged in → show profile card (avatar, name, email, org, tier) + logout button

**Acceptance:** User can log in and see their profile info. Login persists across page refreshes.

### Step 1.12 — Integrate CloudSettings into SettingsDialog

Add "Cloud" tab to the existing `SettingsDialog.tsx`.

**Acceptance:** Cloud tab appears in settings. Only shows when cloud is configured.

---

## Phase 2: Workspace + Conversation Sync

**Goal:** User can link local workspace to cloud and sync state bidirectionally.

**Estimated effort:** 3–4 days

**Depends on:** Phase 1 complete

### Step 2.1 — `src/cloud/cloud-workspace-sync.mjs`

Implement workspace state sync module.

**Methods to implement:**
- `constructor(client, eventBus)`
- `link(localDir, cloudWorkspaceId)` — create `.cloud-link.json`, emit `cloud:workspace:linked`
- `unlink(localDir)` — delete `.cloud-link.json`, emit `cloud:workspace:unlinked`
- `loadLink(localDir)` — read `.cloud-link.json` if exists, return parsed or null
- `push(cloudWorkspaceId, localState)` — PATCH `/rest/v1/workspaces?id=eq.{id}` with state fields, emit `cloud:workspace:pushed`
- `pull(cloudWorkspaceId)` — GET `/rest/v1/workspaces?id=eq.{id}`, return cloud state, emit `cloud:workspace:pulled`
- `listCloudWorkspaces(orgId)` — GET `/rest/v1/workspaces?org_id=eq.{orgId}`

**Acceptance:** Can link/unlink workspaces. Push sends correct PATCH. Pull returns cloud state. `.cloud-link.json` persists across restarts.

### Step 2.2 — `src/cloud/cloud-conversation-sync.mjs`

Implement conversation/message sync module.

**Methods to implement:**
- `constructor(client, eventBus)`
- `linkConversation(localName, cloudConvId)` — update `.cloud-link.json` conversations map
- `pushMessages(cloudConvId, messages, lastSyncAt)` — filter messages after lastSyncAt, POST each to `/rest/v1/messages`, return new lastSyncAt
- `pullMessages(cloudConvId, since)` — GET `/rest/v1/messages?conversation_id=eq.{id}&created_at=gt.{since}`, filter self-sent, return new messages
- `listCloudConversations(cloudWorkspaceId)` — GET `/rest/v1/conversations?workspace_id=eq.{id}`
- `createCloudConversation(cloudWorkspaceId, name, type)` — POST `/rest/v1/conversations`

**Acceptance:** Messages push to cloud. New messages from cloud pull down. Deduplication prevents duplicates. System messages excluded from sync.

### Step 2.3 — Expand `src/cloud/cloud-sync.mjs`

Add workspace and conversation sync to the orchestrator.

**New methods:**
- `linkWorkspace(cloudWorkspaceId)` — delegates to workspaceSync.link, loads conversation links
- `unlinkWorkspace()` — delegates to workspaceSync.unlink
- `pushWorkspaceState(localState)` — delegates to workspaceSync.push with linked workspace ID
- `pullWorkspaceState()` — delegates to workspaceSync.pull
- `listCloudWorkspaces()` — delegates to workspaceSync.listCloudWorkspaces with org ID from auth
- `pushConversation(localName, messages)` — delegates to conversationSync
- `pullConversation(localName)` — delegates to conversationSync
- `_startAutoSync()` — start polling timers for workspace state + presence
- `_stopAutoSync()` — clear timers

**Update `login()`** to auto-load workspace link from `.cloud-link.json` if it exists, then start auto-sync.

**Update `getStatus()`** to include `linkedWorkspace` and `syncState`.

**Acceptance:** After login, if workspace was previously linked, auto-sync starts. Status reports linked workspace.

### Step 2.4 — Expand `src/server/ws-handlers/cloud-handler.mjs`

Add workspace and sync handlers.

**New handlers:**
- `cloud:list-workspaces`
- `cloud:link-workspace`
- `cloud:unlink-workspace`
- `cloud:sync-push`
- `cloud:sync-pull`

**Acceptance:** All workspace/sync operations work through WS messages.

### Step 2.5 — Expand `ui/src/services/wsService.ts`

Add workspace/sync methods.

**New methods:**
- `cloudListWorkspaces()`
- `cloudLinkWorkspace(id)`
- `cloudUnlinkWorkspace()`
- `cloudSyncPush()`
- `cloudSyncPull()`

### Step 2.6 — `ui/src/components/features/CloudSyncIndicator.tsx`

Create sync status indicator for the status bar.

**Visual states:** synced (☁️ blue), syncing (🔄), offline (⚪), error (🔴), hidden (not configured)

**Popover on click:** Last sync time, manual push/pull buttons, linked workspace name.

### Step 2.7 — Integrate CloudSyncIndicator into StatusBar

Add to `ui/src/components/layout/StatusBar.tsx`.

### Step 2.8 — Expand CloudSettings with workspace linking

Add to CloudSettings:
- List of cloud workspaces (dropdown)
- Link/Unlink button
- Current link status
- Sync toggles (auto-sync, conversation sync, workspace state sync)

### Step 2.9 — Update `useCloudSync.ts`

Add workspace/sync state and actions.

**New state fields:** `linkedWorkspace`, `workspaces`, `syncState`

**New actions:** `linkWorkspace`, `unlinkWorkspace`, `syncPush`, `syncPull`, `listWorkspaces`

**New listeners:** `cloud:workspaces`, `cloud:sync-status`, `cloud:sync-result`, `cloud:conflict`

---

## Phase 3: Cloud Agents + AI Proxy

**Goal:** User can invoke cloud agents and route AI through cloud proxy.

**Estimated effort:** 2–3 days

**Depends on:** Phase 1 complete (Phase 2 optional)

### Step 3.1 — `src/cloud/cloud-agent.mjs`

Implement cloud agent module.

**Methods to implement:**
- `constructor(client, eventBus)`
- `listAgents(orgId)` — GET `/rest/v1/cloud_agents?org_id=eq.{orgId}&select=id,name,slug,agent_type,description,status,avatar_url`
- `invoke(agentSlug, conversationId, message, messageHistory)` — POST `/functions/v1/agent-chat`, return `{ content, messageId, agentName }`

**Acceptance:** Agent list returns correctly. Invocation returns agent response.

### Step 3.2 — Expand `src/cloud/cloud-sync.mjs` with agent + AI proxy

**New methods:**
- `listAgents()` — delegates to cloudAgent.listAgents with org ID
- `invokeAgent(slug, message, history)` — delegates to cloudAgent.invoke with conversation context
- `aiProxyRequest(provider, model, messages, stream)` — POST to `/functions/v1/ai-proxy`
- `aiProxyStream(model, messages)` — uses `this.client.stream()` for SSE

**Acceptance:** Agent invocation works end-to-end. AI proxy returns completions.

### Step 3.3 — Expand `src/server/ws-handlers/cloud-handler.mjs`

**New handlers:**
- `cloud:list-agents`
- `cloud:invoke-agent` — also broadcasts result as chat message

### Step 3.4 — Expand `ui/src/services/wsService.ts`

**New methods:**
- `cloudListAgents()`
- `cloudInvokeAgent(slug, message, history?)`

### Step 3.5 — Modify `src/core/ai-provider.mjs`

Add `cloud` provider case.

**Changes:**
- In `createProviderContext()`: detect `AI_PROVIDER === 'cloud'`
- In `callProvider()`: add `case 'cloud'` that calls `cloudSync.aiProxyRequest()`
- In `callProviderStream()`: add `case 'cloud'` that calls `cloudSync.aiProxyStream()`
- Add fallback logic: on cloud failure, try next available local provider

**Acceptance:** Setting `AI_PROVIDER=cloud` routes AI calls through cloud proxy. Fallback works on cloud error.

### Step 3.6 — Update `src/config.mjs`

Document `cloud` as valid provider in comments and `DEFAULT_MODELS`.

### Step 3.7 — Expand `useCloudSync.ts`

**New state:** `agents: CloudAgent[]`

**New actions:** `listAgents`, `invokeAgent`

**New listeners:** `cloud:agents`, `cloud:agent-response`, `cloud:agent-error`

### Step 3.8 — Expand CloudSettings with agent list + AI proxy toggle

Add to CloudSettings:
- Agent list (name, type, status)
- Invoke button per agent (opens input)
- AI Proxy toggle: "Route AI requests through Oboto Cloud"

---

## Phase 4: Realtime + Presence

**Goal:** Sub-second collaboration — live presence, instant messages, typing indicators.

**Estimated effort:** 3–4 days

**Depends on:** Phase 2 complete

### Step 4.1 — `src/cloud/cloud-realtime.mjs`

Implement Phoenix Channel WebSocket client.

**Methods to implement:**
- `constructor(cloudUrl, anonKey, accessToken, eventBus)`
- `connect()` — open WSS to `/realtime/v1/websocket`, authenticate, start heartbeat
- `_authenticate()` — send auth message with access token
- `_startHeartbeat()` / `_stopHeartbeat()` — 30s heartbeat ping
- `_handleMessage(msg)` — route by topic/event to registered callbacks
- `_send(topic, event, payload)` — send Phoenix message with auto-incrementing ref
- `subscribeToMessages(conversationIds)` — join `realtime:public:messages` with postgres_changes filter
- `subscribeToWorkspace(workspaceId)` — join `realtime:public:workspaces` with filter
- `joinPresence(workspaceId, userInfo)` — join presence channel, track/untrack
- `broadcast(workspaceId, event, payload)` — ephemeral broadcast (typing, cursor)
- `disconnect()` — leave all channels, close WS

**Acceptance:** WebSocket connects, heartbeat keeps alive, database changes arrive in real-time.

### Step 4.2 — Integrate CloudRealtime into CloudSync

**Changes to `cloud-sync.mjs`:**
- On login + workspace link: create CloudRealtime, connect, subscribe to workspace + messages
- On new message from realtime: emit `cloud:message:received` on eventBus
- On workspace change from realtime: emit `cloud:workspace:remote-update`
- On presence change: emit `cloud:presence:updated`
- On logout/unlink: disconnect realtime
- Replace polling with realtime where available (keep polling as fallback)

### Step 4.3 — `ui/src/components/features/CloudPresenceBar.tsx`

Create presence indicator component.

**Features:**
- Row of colored avatar circles (max 5 visible + "+N" overflow)
- Tooltip on hover: name, status, current file
- Only visible when cloud connected + workspace linked + members > 0

### Step 4.4 — Integrate CloudPresenceBar into layout

Add to Header.tsx or Sidebar.tsx.

### Step 4.5 — Expand `useCloudSync.ts` with presence

**New state:** `onlineMembers: OnlineMember[]`

**New listeners:** `cloud:presence`

### Step 4.6 — Expand cloud-handler.mjs with presence

**New handlers:**
- `cloud:get-presence` — return current online members

### Step 4.7 — Add eventBus listeners for realtime events

In `web-server.mjs`, add:
- `cloud:message:received` → broadcast as chat message
- `cloud:presence:updated` → broadcast `cloud:presence`

---

## Pre-Implementation Checklist

Before starting Phase 1, verify:

- [ ] `OBOTO_CLOUD_URL` and `OBOTO_CLOUD_KEY` values available (from Supabase project in oboto-1fdb6109)
- [ ] Supabase auth is working (can login via REST from curl)
- [ ] RLS policies allow profile/org reads for authenticated users
- [ ] `SecretsManager` has `get()` and `set()` methods (verify interface)
- [ ] `WsDispatcher.registerAll()` works with new handler module (verify pattern)

---

## Testing Strategy

| Phase | Unit Tests | Integration Tests |
|-------|-----------|-------------------|
| 1 | CloudClient (mock fetch), CloudAuth (mock client) | Login flow end-to-end with test Supabase instance |
| 2 | CloudWorkspaceSync, CloudConversationSync (mock client) | Link + push + pull cycle |
| 3 | CloudAgent (mock client), AI provider cloud case | Agent invocation, AI proxy routing |
| 4 | CloudRealtime (mock WebSocket) | Full realtime flow with live Supabase |

Test files go in `src/cloud/__tests__/`.

---

*This plan should be executed sequentially within each phase. Phases 2 and 3 can run in parallel after Phase 1.*
