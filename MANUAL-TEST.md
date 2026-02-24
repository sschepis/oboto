# Oboto — Manual Test Plan

> **Application:** Oboto AI Assistant  
> **Version:** 1.1.1  
> **Date:** 2026-02-24  
> **Prerequisite:** Node.js v18+, pnpm, a valid `.env` with at least one AI provider API key configured.

---

## Table of Contents

2. [Connection & WebSocket](#2-connection--websocket)
3. [Chat & Messaging](#3-chat--messaging)
4. [Conversation Management](#4-conversation-management)
5. [File Browser & Editor](#5-file-browser--editor)
6. [Surfaces (Generative UI)](#6-surfaces-generative-ui)
7. [Tab Management](#7-tab-management)
8. [Settings Dialog](#8-settings-dialog)
9. [Agentic Provider Settings](#9-agentic-provider-settings)
10. [Model Routing](#10-model-routing)
11. [Command Palette](#11-command-palette)
12. [Slash Commands](#12-slash-commands)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [File Attachments & Voice Input](#14-file-attachments--voice-input)
15. [Tool Execution & Confirmation](#15-tool-execution--confirmation)
16. [Agent Loop Controls](#16-agent-loop-controls)
17. [Task Manager](#17-task-manager)
18. [Terminal (Guake-style)](#18-terminal-guake-style)
19. [Console / Log Panel](#19-console--log-panel)
20. [Secrets Vault](#20-secrets-vault)
21. [Workspace Switching](#21-workspace-switching)
22. [OpenClaw Integration](#22-openclaw-integration)
23. [Setup Wizard](#23-setup-wizard)
24. [Skills Management](#24-skills-management)
25. [Cloud Integration](#25-cloud-integration)
26. [Themes](#26-themes)
27. [Lock Screen](#27-lock-screen)
28. [Status Bar](#28-status-bar)

---

## 1. Setup & Launch

### 1.1 First-time Installation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | `git clone` the repo, run `pnpm install` | Dependencies install without errors |
| 2 | `cp .env.example .env` and fill in at least one API key | `.env` file created |
| 3 | `cd ui && pnpm install && pnpm run build` | UI builds successfully in `ui/dist/` |

### 1.2 Start Backend Server

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `npm run serve` (or `node src/server/server.mjs`) | Server starts on port 3000, logs `Server listening on ...` |
| 2 | Check terminal for initialization messages | Conversation manager loads, default "chat" conversation created |

### 1.3 Start UI Dev Server

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In separate terminal, run `npm run dev:ui` | Vite dev server starts on `http://localhost:5173` |
| 2 | Open `http://localhost:5173` in browser | Oboto UI loads with header, sidebar, chat area, and status bar |

---

## 2. Connection & WebSocket

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 2.1 | Auto-connect | Open UI | Green wifi icon in header; status bar shows "Connected" |
| 2.2 | Reconnect on disconnect | Stop backend server, wait 2 seconds, restart | UI shows "Disconnected" (red wifi icon), then auto-reconnects with exponential backoff; eventually shows "Connected" again |
| 2.3 | Workspace restore | Refresh the page (F5) | Previously selected workspace is restored from `localStorage` |

---

## 3. Chat & Messaging

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 3.1 | Send a message | Type "Hello" in the input area, press Enter | User message appears in chat. Agent starts working (spinner in header). AI response appears when complete |
| 3.2 | Shift+Enter for newline | Press Shift+Enter in input | Inserts a newline without sending |
| 3.3 | Message queue | While agent is working, type another message and press Enter | "Queue a message..." placeholder shown; queued count badge appears. When agent finishes, queued message auto-sends |
| 3.4 | Stop/Interrupt | While agent is working, click the red stop button (square icon) | Agent stops processing. Queue is cleared |
| 3.5 | Delete message | Hover over a message, click the delete (trash) icon | Message removed from chat |
| 3.6 | Edit & rerun | Hover over a user message, click edit icon, modify text, submit | Original message updated; all subsequent messages removed; message re-sent to agent |
| 3.7 | Rerun from user message | Hover over a user message, click the rerun icon | Messages after it are removed; same message re-sent |
| 3.8 | Regenerate AI response | Hover over an AI message, click the regenerate icon | AI response and subsequent messages removed; preceding user message re-sent |
| 3.9 | Tool call display | Ask the agent to perform a file operation (e.g., "list files in the current directory") | Tool call block appears with tool name, args, and result. Shows "running" spinner then "completed" status |
| 3.10 | Markdown rendering | Send a message that triggers markdown response (e.g., "explain async/await") | Response renders with proper code blocks, headers, lists |
| 3.11 | Test results display | Type `/test` to run tests | Test results panel shows passed/failed/pending counts |

---

## 4. Conversation Management

### 4.1 Create Conversation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the "+" button in the tab bar → "New Chat" | Prompt for conversation name appears |
| 2 | Enter a name (e.g., "research-task") | New conversation tab appears; chat history is empty; sidebar/header conversation switcher updates |

### 4.2 Switch Conversation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click a different conversation tab or use the conversation switcher dropdown in the header | Chat messages update to show that conversation's history; active conversation name updates in status bar |

### 4.3 Rename Conversation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Right-click a conversation tab | Context menu appears |
| 2 | Click "Rename", type new name, press Enter | Tab label updates; conversation list refreshes |

### 4.4 Clear Conversation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Right-click a conversation tab | Context menu appears with "Clear Conversation" option (Eraser icon) |
| 2 | Click "Clear Conversation" | Confirmation dialog: `Clear all messages in "X"? This cannot be undone.` |
| 3 | Click OK | All messages removed from that conversation; if it's the active conversation, chat area becomes empty; message count in sidebar updates to 0 |
| 4 | Send a new message in the cleared conversation | Agent responds normally with fresh context (system prompt re-injected) |

### 4.5 Delete Conversation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Right-click a conversation tab (not "chat") | Context menu shows "Delete" option |
| 2 | Click "Delete", confirm | Conversation removed; if active, switches to default "chat" conversation |
| 3 | Try to delete the "chat" conversation | Should fail with error — default conversation cannot be deleted |

### 4.6 Conversation Persistence

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send messages in a conversation, then restart the backend server | After restart, open UI — conversation history is preserved from `.conversations/*.json` files |

---

## 5. File Browser & Editor

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 5.1 | File tree display | Check left sidebar | File tree shows workspace directory structure with folders and files |
| 5.2 | Open file | Click a `.js`, `.ts`, `.md`, or `.json` file in the sidebar | New tab opens with file contents in the editor |
| 5.3 | Edit and save | Modify file content, press `⌘S` | File saves; dirty indicator (dot on tab) clears |
| 5.4 | Open image | Click a `.png`, `.jpg` etc. file | Image viewer tab opens |
| 5.5 | Open PDF | Click a `.pdf` file | PDF viewer tab opens |
| 5.6 | Open HTML | Click an `.html` file | HTML preview tab opens with rendered content |

---

## 6. Surfaces (Generative UI)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 6.1 | View surfaces | Check the Surfaces section in the sidebar | Lists any existing surfaces |
| 6.2 | Create surface | Click "+" → "New Surface" in the tab bar | New surface tab opens; appears in sidebar |
| 6.3 | Ask agent to create a surface | Send: "Create a dashboard surface showing system info" | Agent uses surface tools to create a React component; new surface appears |
| 6.4 | Rename surface | Right-click surface in sidebar → Rename | Name updates |
| 6.5 | Delete surface | Right-click surface in sidebar → Delete | Surface removed from sidebar and any open tab closes |
| 6.6 | Duplicate surface | Right-click surface in sidebar → Duplicate | New copy of the surface appears |
| 6.7 | Pin surface | Use the pin toggle in the surface renderer | Surface pins/unpins |

---

## 7. Tab Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 7.1 | Default chat tab | On load | "Chat" tab is active and cannot be closed |
| 7.2 | Open multiple tabs | Open several files and surfaces | Multiple tabs appear in the tab bar |
| 7.3 | Close tab | Click the X on a tab (or `⌘W`) | Tab closes; next tab becomes active |
| 7.4 | Tab switching via keyboard | Press `⌘1`–`⌘9` | Switches to the corresponding tab by index; `⌘9` goes to last tab |
| 7.5 | Next/Previous tab | `⌘⇧]` / `⌘⇧[` | Cycles through tabs forward/backward |
| 7.6 | Tab context menu | Right-click a conversation tab | Shows Clear, Rename, Delete options |

---

## 8. Settings Dialog

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 8.1 | Open settings | Click gear icon in header, or press `⌘,` | Settings dialog opens |
| 8.2 | General tab | Navigate to General tab | Shows maxTurns, maxSubagents, and other general properties |
| 8.3 | AI tab — Config | Navigate to AI tab → Config sub-tab | Shows AI provider configuration with model selection, API key fields, endpoint |
| 8.4 | AI tab — Routing | Navigate to AI tab → Model Routing sub-tab | Shows model routing configuration per task role (agentic, reasoning, summarizer, etc.) |
| 8.5 | AI tab — Agent Mode | Navigate to AI tab → Agent Mode sub-tab | Shows agentic provider list (see §9) |
| 8.6 | OpenClaw tab | Navigate to OpenClaw tab | Shows OpenClaw connection status and configuration |
| 8.7 | Skills tab | Navigate to Skills tab | Shows installed skills and ClawHub search (see §24) |
| 8.8 | Cloud tab | Navigate to Cloud tab | Shows cloud login/sync options (see §25) |
| 8.9 | Save settings | Modify a setting, click Save/Apply | Settings persisted; server acknowledges |
| 8.10 | Run Setup Wizard link | Click the setup wizard button | Opens the setup wizard (see §23) |
| 8.11 | Secrets link | Click "Manage Secrets" | Opens Secrets Vault panel |

---

## 9. Agentic Provider Settings

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 9.1 | View providers | Open Settings → AI → Agent Mode | List of available agentic providers displayed with name, description, and ID |
| 9.2 | Active indicator | Check currently active provider | Shows indigo highlight, "Active" badge, and glowing dot |
| 9.3 | Switch provider | Click a different provider card | Provider switches; active indicator moves; server broadcasts updated state |
| 9.4 | Empty state | (If no providers configured on server) | Shows "No agentic providers available. Check server configuration." message |
| 9.5 | Provider loads on connect | Refresh the page | `getAgenticProviders` is called on WebSocket connect; list populates automatically |

---

## 10. Model Routing

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 10.1 | View routing | Settings → AI → Model Routing | Shows routing configuration per role |
| 10.2 | Change route | Assign a different model to "agentic" role | Setting saved; status bar model selector reflects the change |
| 10.3 | Model selector (input area) | Click the bot icon (⊡) in the input area's left side | Dropdown shows all available models grouped by provider |
| 10.4 | Model selector (status bar) | Click the model name in the status bar | Dropdown with grouped models appears; selecting one updates the agentic route |

---

## 11. Command Palette

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 11.1 | Open palette | Press `⌘⇧P` or click the Command icon in the header | Command palette overlay appears |
| 11.2 | Search & select | Type "settings" | Filtered list shows "System Settings"; click or Enter to open settings |
| 11.3 | Available actions | Scroll through palette | Should list: Toggle Theme, Export Protocol Log, Manage Personas, System Settings, Deploy OpenClaw, Secrets Vault, Task Manager, Terminal, Console, Shortcuts, Change Workspace, Lock Terminal, Clear Chat, Reset UI Style, and theme variants |
| 11.4 | Close palette | Press Escape or click outside | Palette closes |

---

## 12. Slash Commands

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 12.1 | Trigger menu | Type `/` in the input area | Inline command menu appears above input |
| 12.2 | Filter commands | Type `/an` | Menu filters to show `/analyze` |
| 12.3 | Select with arrows | Press ↑/↓ arrow keys | Highlight moves through menu items |
| 12.4 | Execute command | Press Enter or Tab on highlighted item | Command is sent as a message |
| 12.5 | Available commands | Type `/` and scroll | Should list: `/analyze`, `/visualize`, `/plan`, `/tasks`, `/sandbox`, `/survey`, `/test`, `/lint`, `/format`, `/doc`, `/term`, `/console`, `/clear`, `/secrets`, `/settings`, `/shortcuts`, `/new-chat` |

---

## 13. Keyboard Shortcuts

| # | Shortcut | Action | Expected Result |
|---|----------|--------|-----------------|
| 13.1 | `⌘⇧P` | Open command palette | Palette opens |
| 13.2 | `⌘,` | Open settings | Settings dialog opens |
| 13.3 | `⌘/` | Show keyboard shortcuts | Shortcuts help dialog opens listing all shortcuts |
| 13.4 | `⌘W` | Close active tab | Active tab closes (not chat tab) |
| 13.5 | `⌘S` | Save current file | File in active editor tab saves |
| 13.6 | `⌘⇧C` | Focus chat input | Chat tab activates; input area focused |
| 13.7 | `⌘⇧T` | Toggle task manager | Task manager panel opens/closes |
| 13.8 | `` ⌘` `` | Toggle terminal | Guake-style terminal slides down from top |
| 13.9 | `⌘J` | Toggle console | Log panel opens/closes from bottom |
| 13.10 | `⌘1`–`⌘9` | Switch to tab N | Corresponding tab activates; `⌘9` = last tab |
| 13.11 | `⌘⇧]` | Next tab | Next tab in order activates |
| 13.12 | `⌘⇧[` | Previous tab | Previous tab in order activates |
| 13.13 | `Escape` | Close terminal | If terminal is focused, it closes |

---

## 14. File Attachments & Voice Input

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 14.1 | Attach file | Click paperclip icon in input area; select a file | File preview chip appears below input with name and size; uploads via WebSocket |
| 14.2 | Attach image | Click image icon; select an image file | Image thumbnail preview appears in attachment bar |
| 14.3 | Paste image | Copy an image to clipboard, paste into input area | Image attachment auto-created from clipboard |
| 14.4 | Remove attachment | Click X on an attachment chip | Attachment removed |
| 14.5 | Send with attachments | Add attachments, type a message, press Enter | Message sent with `[attached: filename]` appended; attachments cleared |
| 14.6 | Voice input | Click microphone icon (if supported) | Mic turns red with waveform animation; speech transcribed to text in real-time |
| 14.7 | Stop voice | Click mic-off icon while recording | Recording stops; transcript finalizes into input field |

---

## 15. Tool Execution & Confirmation

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 15.1 | Tool execution display | Ask agent to read a file | Tool call block appears showing tool name, args, running spinner, then result |
| 15.2 | Confirmation dialog | Ask agent to perform a dangerous action (e.g., delete a file) | Confirmation dialog appears with Approve, Deny, Always Allow options |
| 15.3 | Approve | Click "Approve" | Tool executes; result displayed |
| 15.4 | Deny | Click "Deny" | Tool is skipped; agent is informed |
| 15.5 | Always Allow | Click "Always Allow" | Tool executes; future identical tool calls skip confirmation |

---

## 16. Agent Loop Controls

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 16.1 | Controls location | Look at center of header | Agent loop controls visible (play/pause/stop buttons) |
| 16.2 | Start agent loop | Click Play button | Agent loop starts with configured interval; status updates |
| 16.3 | Pause agent loop | Click Pause button while running | Loop pauses; can be resumed |
| 16.4 | Stop agent loop | Click Stop button | Loop fully stops |
| 16.5 | Set interval | Adjust interval setting | Agent loop interval changes |
| 16.6 | Last invocation | After loop runs at least once | Shows timestamp of last invocation |

---

## 17. Task Manager

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 17.1 | Open task manager | Press `⌘⇧T` or via command palette | Task Manager panel opens as modal overlay |
| 17.2 | View tasks | Check task list | Shows running, completed, and pending tasks |
| 17.3 | Task sidebar | Click "Tasks" button in status bar | Task sidebar opens inline in the conversation area |
| 17.4 | Running count | While background tasks are running | Status bar shows running task count with amber badge |
| 17.5 | Close task manager | Click close button or press `⌘⇧T` again | Panel closes |

---

## 18. Terminal (Guake-style)

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 18.1 | Open terminal | Press `` ⌘` `` or type `/term` | Terminal slides down from the top of the screen |
| 18.2 | Execute commands | Type shell commands (e.g., `ls`, `pwd`) | Commands execute; output displayed |
| 18.3 | Close terminal | Press Escape while focused, or `` ⌘` `` again | Terminal slides up and hides |
| 18.4 | Terminal persistence | Open terminal, type a command, close, reopen | Terminal state (including output history) persists |

---

## 19. Console / Log Panel

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 19.1 | Open console | Press `⌘J` or click "Console" in status bar or type `/console` | Log panel slides up from bottom |
| 19.2 | View logs | Trigger some agent activity | Log entries appear with level, timestamp, and message |
| 19.3 | Clear logs | Click the clear button in log panel | All log entries removed |
| 19.4 | Log limit | Generate many logs | Buffer caps at 500 entries (oldest removed) |
| 19.5 | Close console | Press `⌘J` again or click close | Panel closes |

---

## 20. Secrets Vault

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 20.1 | Open secrets panel | Press `⌘K` or via command palette "Secrets Vault", or type `/secrets` | Secrets panel opens |
| 20.2 | View secrets | Check the secrets list | Shows stored API keys with masked values |
| 20.3 | Add secret | Click add button, enter key name and value | Secret saved and encrypted in `.secrets.enc` |
| 20.4 | Delete secret | Click delete on a secret entry | Secret removed from vault |
| 20.5 | Priority order | Set a key in both `.env` and vault | Shell env vars > Vault > `.env` > defaults |
| 20.6 | Close panel | Click close button | Panel closes |

---

## 21. Workspace Switching

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 21.1 | Open directory picker | Click workspace path in header, or via command palette "Change Workspace" | Directory picker dialog opens |
| 21.2 | Navigate directories | Browse the file system in the picker | Directories listed; can navigate up/down |
| 21.3 | Select workspace | Click a directory and confirm | Loading spinner shows "Switching workspace…"; chat history clears; new workspace loads with its own conversations and file tree |
| 21.4 | Persistence | Switch workspace, refresh page | Same workspace restored from `localStorage` |
| 21.5 | Timeout fallback | (If server never responds after 10s) | Switching state auto-clears to prevent permanent spinner |

---

## 22. OpenClaw Integration

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 22.1 | Status badge | If OpenClaw is configured | Header shows "🦞 OC" badge with connection indicator dot |
| 22.2 | Connected state | When OpenClaw is connected | Badge is green; tooltip shows mode and URL |
| 22.3 | Disconnected state | When OpenClaw is not connected | Badge is gray |
| 22.4 | Configure | Open Settings → OpenClaw tab | Can set mode (integrated/external), URL, auth token, path |
| 22.5 | Deploy | Via command palette "Deploy OpenClaw" | Starts local OpenClaw gateway |
| 22.6 | @openclaw mention | Type `@openclaw` in chat input | Green "OC" badge appears next to input, indicating the message will be routed to OpenClaw |
| 22.7 | Polling | Wait 15 seconds | OpenClaw status auto-refreshes via polling |

---

## 23. Setup Wizard

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 23.1 | First-run trigger | On first launch (no prior configuration) | Setup wizard overlay appears automatically |
| 23.2 | Manual trigger | Settings → "Run Setup Wizard" button | Wizard opens |
| 23.3 | Provider selection step | Step through wizard | Can select AI provider (OpenAI, Gemini, Anthropic, etc.) |
| 23.4 | API key step | Enter API key | Can validate key with "Test" button (10s timeout) |
| 23.5 | Workspace step | Select workspace directory | Directory picker allows workspace selection |
| 23.6 | OpenClaw step | Optional OpenClaw configuration | Can skip or configure OpenClaw with install options |
| 23.7 | Cloud step | Optional cloud configuration | Can skip or set up Oboto Cloud |
| 23.8 | Review step | Final review | Shows summary of all selections |
| 23.9 | Complete | Click finish | Wizard closes; settings applied |
| 23.10 | Skip | Click "Skip" at any time | Wizard closes without applying changes |

---

## 24. Skills Management

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 24.1 | View installed skills | Settings → Skills tab | Lists installed skills with name and description |
| 24.2 | Search ClawHub | Type a search query in ClawHub search | Shows matching skills from ClawHub registry |
| 24.3 | Install from ClawHub | Click Install on a ClawHub skill | Skill installs with progress indicator |
| 24.4 | Install from npm | Enter npm package name and install | Skill installs from npm |
| 24.5 | Uninstall skill | Click Uninstall on an installed skill | Skill removed |
| 24.6 | Error handling | Try installing a non-existent skill | Error message displayed; can clear with "Clear Error" |

---

## 25. Cloud Integration

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 25.1 | Login | Settings → Cloud tab; enter email/password | Authenticated with Oboto Cloud |
| 25.2 | Sync status | After login | Cloud sync indicator appears in status bar |
| 25.3 | Push/Pull sync | Click sync buttons | Workspace data synced with cloud |
| 25.4 | Presence | After login | Cloud presence bar shows connected users |
| 25.5 | Logout | Click logout | Session cleared |

---

## 26. Themes

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 26.1 | Change theme via palette | Command palette → "Theme: Cyberpunk" (or any theme) | UI colors update immediately |
| 26.2 | Available themes | Check command palette | Cyberpunk, Ocean, Sunset, Matrix, Midnight, Arctic, Forest, Lavender, Ember, Monochrome, Daylight, Paper, Corporate |
| 26.3 | Reset theme | Command palette → "Reset UI Style" | Theme reverts to default |

---

## 27. Lock Screen

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 27.1 | Lock | Command palette → "Lock Terminal" | UI blurs entirely behind lock screen overlay |
| 27.2 | Unlock | Click the unlock button on the lock screen | Lock screen dismissed; UI restored |

---

## 28. Status Bar

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 28.1 | Connection status | Check far-left of status bar | Shows "Connected" (green) or "Disconnected" (red); clickable to open settings |
| 28.2 | Git branch | If workspace is a git repo | Shows current branch name with branch icon |
| 28.3 | Agent status | While agent is working / idle | Shows "Working" with spinner (+ queued count) or "Ready" with check icon |
| 28.4 | Active conversation | Check right side | Shows current conversation name |
| 28.5 | Project type | If detected | Shows project type (e.g., "Node.js") |
| 28.6 | File count | If workspace has files | Shows total file count |
| 28.7 | Model selector | Click model name in status bar | Opens model selection dropdown |
| 28.8 | Tasks button | Click "Tasks" | Toggles task sidebar |
| 28.9 | Terminal button | Click "Terminal" | Toggles Guake terminal |
| 28.10 | Console button | Click "Console" | Toggles log panel |

---

## Regression Checks

After making any code changes, verify these critical paths:

1. **Send → Receive cycle:** Send a chat message, verify AI response arrives
2. **Conversation CRUD:** Create, switch, clear, rename, delete conversations
3. **Settings round-trip:** Change a setting, reload, verify it persists
4. **Workspace switch:** Switch workspaces, verify file tree and conversations update
5. **Tool confirmation flow:** Trigger a confirmable tool, approve/deny
6. **WebSocket reconnection:** Kill and restart backend, verify UI reconnects and restores state
