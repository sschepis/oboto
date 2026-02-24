# Obodo Client Manual Test Plan

## Test Environment
- **URL:** http://localhost:3000
- **Test Workspace:** /Users/sschepis/Development/obodo-test-workspace
- **Start Command:** `export OBOTO_DYNAMIC_ROUTES=true && pnpm run build:ui && pnpm run start:server`

## Test Categories

### 1. Basic Connectivity & UI Load
- [ ] **T1.1** Server starts without errors
- [ ] **T1.2** Web UI loads at http://localhost:3000
- [ ] **T1.3** WebSocket connection established (check browser console)
- [ ] **T1.4** Settings panel accessible
- [ ] **T1.5** File tree renders in sidebar

### 2. Chat & Agent Loop (Default Eventic Provider)
- [ ] **T2.1** Send a simple greeting ("Hello, who are you?") — agent responds
- [ ] **T2.2** Send a knowledge question ("What is the Fibonacci sequence?") — agent answers without tools
- [ ] **T2.3** Ask agent to read a file ("Read hello.js and explain it") — agent uses read_file tool
- [ ] **T2.4** Ask agent to create a file ("Create a file called test-output.txt with 'Hello World'") — file is created
- [ ] **T2.5** Ask agent to run a command ("Run `node -e 'console.log(2+2)'`") — command executes
- [ ] **T2.6** Ask agent to find a bug ("Review hello.js and find any bugs") — agent identifies divide-by-zero
- [ ] **T2.7** Stop/cancel a running agent request (click stop button mid-response)
- [ ] **T2.8** Message history persists after page refresh

### 3. Workspace Switching
- [ ] **T3.1** Switch workspace to test-workspace via settings — spinner shows, then loads
- [ ] **T3.2** File tree updates to show test-workspace files
- [ ] **T3.3** Chat history clears on workspace switch
- [ ] **T3.4** Switch back to ai-man workspace — spinner, then loads previous state
- [ ] **T3.5** Conversations are isolated per workspace

### 4. Skills Management
- [ ] **T4.1** Ask agent to list skills ("What skills do you have?") — returns list
- [ ] **T4.2** Ask agent to create a skill ("Create a skill called 'code-review' that teaches you to review code for security issues")
- [ ] **T4.3** Ask agent to read the created skill ("Read the code-review skill")
- [ ] **T4.4** Ask agent to use the skill ("Use the code-review skill to review hello.js")
- [ ] **T4.5** Ask agent to edit the skill ("Edit the code-review skill to also check for performance issues")
- [ ] **T4.6** Ask agent to delete the skill ("Delete the code-review skill")

### 5. Agentic Provider Switching
- [ ] **T5.1** Check current agentic provider (via settings or WS message)
- [ ] **T5.2** Switch to cognitive provider — verify it initializes
- [ ] **T5.3** Send a message with cognitive provider — verify response includes cognitive metadata
- [ ] **T5.4** Switch back to eventic provider — verify it works
- [ ] **T5.5** Provider persists across page refresh (or resets gracefully)

### 6. Conversations
- [ ] **T6.1** List conversations (`{type: "list-conversations"}`)
- [ ] **T6.2** Create a new conversation (`{type: "create-conversation", payload: { name: "Test Conversation" }}`)
- [ ] **T6.3** Switch between conversations
- [ ] **T6.4** Conversation list updates correctly
- [ ] **T6.5** Delete a conversation

### 7. Error Handling
- [ ] **T7.1** Send empty message — handled gracefully
- [ ] **T7.2** Send unknown WebSocket message type — logged warning, no crash
- [ ] **T7.3** Send malformed JSON over WebSocket — parse error logged, no crash
- [ ] **T7.4** Disconnect network briefly — reconnection works
- [ ] **T7.5** Invalid tool call from agent — error shown, agent continues

### 8. UI Polish
- [ ] **T8.1** Activity log panel opens and shows tool calls
- [ ] **T8.2** Messages render markdown correctly (code blocks, lists, etc.)
- [ ] **T8.3** Long responses scroll properly
- [ ] **T8.4** Dark theme renders correctly
- [ ] **T8.5** Mobile/responsive behavior (resize window)

## Defect Log
| # | Test | Issue Description | Severity | Status |
|---|------|-------------------|----------|--------|
|   |      |                   |          |        |

## Test Results (2026-02-24)

### Round 1 — Basic Connectivity & Infrastructure
| Test | Result | Notes |
|------|--------|-------|
| T1.2 UI Loads | PASS | http://localhost:3000 serves React app |
| T1.3 WebSocket | PASS | Connects successfully |
| T1.4 Settings | PASS | Settings accessible via WS |
| T1.5 Static Assets | PASS | CSS, JS bundles served correctly |
| T2.1 Basic Chat | PASS | After fix — chat handler now normalizes payload types |
| T3.1-T3.4 Workspace Switch | PASS | Switch, file listing, history cleared, switch back |
| T5.1-T5.2 Agentic Providers | PASS | List providers, get active provider |

### Round 2 — Skills, Conversations, Error Handling
| Test | Result | Notes |
|------|--------|-------|
| T4.1 Skills List | PASS | list-skills handler fix verified |
| T6.1 List Conversations | PASS | Returns conversation-list |
| T6.2 Create Conversation | PASS | Corrected to use `create-conversation` type |
| T7.1 Empty Message | PASS | Handled gracefully |
| T7.2 Unknown Type | PASS | Logged warning, no crash |
| T7.3 Malformed JSON | PASS | Parse error logged, no crash |

### Bugs Found & Fixed (Rounds 1-2: 3 of 5 total)
1. **Chat handler crash** — `userInput.match is not a function` when payload was an object. Fixed in [`chat-handler.mjs:24`](src/server/ws-handlers/chat-handler.mjs:24).
2. **Missing list-skills handler** — `list-skills` WS type had no handler. Fixed in [`skills-handler.mjs`](src/server/ws-handlers/skills-handler.mjs) exports.
3. **Shell injection** — 4 instances of `execAsync` with user input in [`skills-manager.mjs`](src/skills/skills-manager.mjs). Fixed with `execFileAsync`.

### Round 3 — Provider Switching, Conversation CRUD, Chat Agent
| Test | Result | Notes |
|------|--------|-------|
| T5.3 Switch to Cognitive | PASS | Provider switched, verified active |
| T5.4 Switch Back to Eventic | PASS | Bidirectional switching works |
| T6.3 Create Conversation | PASS | `create-conversation` with name |
| T6.4 Load/Switch Conversation | PASS | Use `switch-conversation` (not `load-conversation`) with `payload: { name }` |
| T6.5 Delete Conversation | PASS | `delete-conversation` with `payload: { name }` (not `id`) |
| T2.2 Chat Agent Response | PASS | "What is 2+2?" → "4" in ~28s |

### Round 4 — Complex Agent Interactions
| Test | Result | Notes |
|------|--------|-------|
| T2.3 File Reading via Chat | PASS | Agent uses `read_file` tool, gracefully handles missing files |
| T2.4 File Creation via Chat | PASS | Agent uses `write_file` tool, file verified on disk |
| T2.5 Shell Command via Chat | PASS | Agent uses `run_command` tool, output reported correctly |
| T4.2 Create Skill via Chat | PASS | Agent uses `create_skill` tool, verified in `list-skills` |
| T4.3 Delete Skill via Chat | PASS | Agent uses `delete_skill` tool, verified removed from `list-skills` |

### Round 5 — Cognitive Provider Chat, Workspace Switch, Stop/Cancel
| Test | Result | Notes |
|------|--------|-------|
| T5.5 Cognitive Provider Chat | PASS | "Capital of France?" → "Paris" via TinyAleph cognitive agent |
| T3.5 Workspace Switch via Settings | PASS | After fix — `update-settings` with `workingDirectory` triggers runtime change |
| T2.6 Stop/Cancel | PASS | After fix — `stop` and `cancel` WS types interrupt in-flight requests |

### Bugs Found & Fixed (Total: 5)
1. **Chat handler crash** — `userInput.match is not a function` when payload was object. Fixed in [`chat-handler.mjs:24`](src/server/ws-handlers/chat-handler.mjs:24).
2. **Missing list-skills handler** — `list-skills` WS type had no handler. Fixed in [`skills-handler.mjs`](src/server/ws-handlers/skills-handler.mjs) exports.
3. **Shell injection** — 4 instances of `execAsync` with user input. Fixed with `execFileAsync` in [`skills-manager.mjs`](src/skills/skills-manager.mjs).
4. **No stop/cancel WS handler** — `stop` and `cancel` message types were unrecognized. Fixed by adding aliases for `handleInterrupt` in [`chat-handler.mjs:153-154`](src/server/ws-handlers/chat-handler.mjs:153).
5. **Settings workspace switch** — `update-settings` with `workingDirectory` didn't trigger runtime change. Fixed in [`settings-handler.mjs:198`](src/server/ws-handlers/settings-handler.mjs:198).

### WebSocket API Reference (Corrected)
| Message Type | Payload | Response Type |
|---|---|---|
| `chat` | `"string"` | `log`, `status`, `message`, `next-steps` |
| `stop` / `cancel` / `interrupt` | none | `status: "idle"` |
| `list-skills` | none | `skills-list` |
| `list-conversations` | none | `conversation-list` |
| `create-conversation` | `{ name }` | `conversation-created` |
| `switch-conversation` | `{ name }` | `history-loaded`, `conversation-switched` |
| `delete-conversation` | `{ name }` | `conversation-deleted` |
| `get-agentic-providers` | none | `agentic-providers` |
| `get-agentic-provider` | none | `agentic-provider` |
| `set-agentic-provider` | `{ providerId }` | `status` |
| `update-settings` | `{ workingDirectory, ai, routing, ... }` | `status`, settings reload |
