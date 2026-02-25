# Notaclaw Plugins Assessment for Oboto

## Summary

Examined **40 plugins** in `../notaclaw/plugins/`. Oboto currently has **14 plugins**. After analysis, **17 plugins are recommended** for import (Tier 1 + Tier 2), **6 are conditionally useful** (Tier 3), and **17 are excluded** as AlephNet/DSN-specific or redundant.

---

## Oboto's Existing Plugins (14)

| Plugin | Description |
|--------|-------------|
| browser | Browser automation |
| chrome-ext | Chrome extension integration |
| cloud-sync | Cloud synchronization |
| embed | Embedding support |
| firecrawl | Web scraping via Firecrawl |
| hello-world | Example plugin |
| image | Image generation/handling |
| math | Math computation |
| openclaw | OpenClaw integration |
| personas | Persona management |
| tts | Text-to-speech |
| ui-themes | UI theming |
| web-search | Web search |
| workflows | Workflow automation |

---

## Tier 1 — High Value, Bring In (11 plugins)

These add significant capabilities oboto lacks today and have clean, portable implementations.

### 1. `code-interpreter`
- **What**: Secure sandboxed environment for code execution
- **Why**: Core capability for any AI assistant — lets the AI run code safely
- **Overlap**: None in oboto
- **Effort**: Medium — needs sandbox adaptation from Electron to Node.js

### 2. `document-reader`
- **What**: Advanced document ingestion with PDF, DOCX, XLSX, Image, and plain text extractors
- **Why**: Essential for handling file uploads and document analysis
- **Overlap**: None
- **Effort**: Low-Medium — well-structured with clean service/extractor pattern

### 3. `knowledge-graph`
- **What**: Semantic knowledge graph with entity/relationship CRUD, semantic think/remember/recall tools
- **Why**: Gives oboto persistent memory and semantic reasoning; 7 AI tools included
- **Overlap**: None — oboto has no structured memory system
- **Effort**: Medium — rich implementation, but core logic is portable

### 4. `planman`
- **What**: AI-driven project manager with task decomposition, agent assignment, progress monitoring, auto-replanning
- **Why**: Oboto has `task-manager.mjs` and `project-management/` but planman is more sophisticated with AI decomposition, prompt chains, and execution orchestration
- **Overlap**: Partial — could replace or augment existing project management
- **Effort**: Medium-High — large codebase (~80KB of TypeScript)

### 5. `poorman-alpha`
- **What**: Computational math with unit conversion, symbolic algebra, matrix ops, SymPy bridge for step-by-step solutions and plots
- **Why**: Significant upgrade over current `math` plugin; includes SymPy integration
- **Overlap**: Replaces/upgrades existing `math` plugin
- **Effort**: Low — well-structured, clean tool definitions

### 6. `canvas-viz`
- **What**: Renders interactive HTML5 Canvas visualizations inline in chat via fence blocks
- **Why**: Enables data visualization and creative coding directly in conversation
- **Overlap**: None
- **Effort**: Low-Medium — self-contained

### 7. `html-artifacts`
- **What**: Generate, preview, and edit HTML/React artifacts
- **Why**: Enables artifact preview/editing like Claude Artifacts or ChatGPT canvas
- **Overlap**: None
- **Effort**: Low-Medium

### 8. `voice-suite`
- **What**: TTS + STT + voice cloning via ElevenLabs and OpenAI, with sound effect generation
- **Why**: Superset of existing `tts` plugin; adds STT, cloning, sound effects
- **Overlap**: Replaces/upgrades existing `tts` plugin
- **Effort**: Low — clean API, well-configured

### 9. `prompt-editor`
- **What**: Visual editor for AI prompt chains and workflows with flow editor, debugger, template library, test cases
- **Why**: Powerful prompt engineering tool for building/debugging complex prompt chains
- **Overlap**: None
- **Effort**: Medium — large React renderer but well-structured

### 10. `semantic-search`
- **What**: Deep semantic search using vector similarity for content retrieval
- **Why**: Enables meaning-based search across all content
- **Overlap**: None — oboto's web-search is external; this is internal semantic search
- **Effort**: Low-Medium

### 11. `notification-center`
- **What**: Centralized hub for system alerts and notifications with filtering, snooze, categories
- **Why**: Good UX for surfacing async events, task completions, errors
- **Overlap**: None
- **Effort**: Low-Medium

---

## Tier 2 — Valuable Additions (6 plugins)

Good capabilities that enhance observability, reliability, or productivity.

### 12. `thought-stream-debugger`
- **What**: Observability tool for inspecting agent execution traces, memory access, and scoring
- **Why**: Essential for debugging agent behavior; no equivalent in oboto
- **Effort**: Medium

### 13. `note-taker`
- **What**: Hierarchical note taking with secure sharing
- **Why**: Useful utility for knowledge capture
- **Effort**: Low

### 14. `workflow-weaver`
- **What**: Visual orchestration engine for chaining agents, tools, and semantic queries
- **Why**: Could enhance or replace existing `workflows` plugin with visual editor
- **Overlap**: Potentially replaces `workflows` plugin
- **Effort**: Medium

### 15. `secure-backup`
- **What**: Encrypted backup and restore with scheduling, retention, integrity verification
- **Why**: Data safety for conversations, settings, knowledge
- **Effort**: Medium

### 16. `temporal-voyager`
- **What**: Time-travel debugging and state replay
- **Why**: Powerful debugging tool for understanding agent state changes
- **Effort**: Medium

### 17. `logger`
- **What**: System log viewer
- **Why**: Basic but useful debugging utility
- **Effort**: Low

---

## Tier 3 — Conditional/Overlap (6 plugins)

These overlap with existing oboto functionality or need significant adaptation.

| Plugin | Reason |
|--------|--------|
| `agent-essentials` | Oboto already has file tools, web search, system info built in |
| `ai-conversations` | Oboto already has `conversation-manager.mjs` |
| `auto-dash` | Interesting generative dashboard but niche use case |
| `theme-studio` | Overlaps with existing `ui-themes` plugin |
| `data-osmosis` | Universal data connector — useful concept but complex, early stage |
| `semantic-whiteboard` | Collaborative canvas — interesting but complex and needs P2P |

---

## Tier 4 — Excluded / AlephNet-Specific (17 plugins)

These are deeply tied to AlephNet's DSN, identity, and tokenomics systems with no direct utility for oboto.

| Plugin | Reason |
|--------|--------|
| `coherence-monitor` | Free Energy / node coherence visualization — AlephNet-specific |
| `domain-registry` | .aleph domain management — AlephNet-specific |
| `entangled-chat` | Prime entanglement P2P comms — AlephNet-specific |
| `federated-trainer` | Distributed SLM training across mesh — AlephNet-specific |
| `governance` | Decentralized governance/voting — AlephNet-specific |
| `iot-resonance-bridge` | IoT device resonance protocols — AlephNet-specific |
| `marketplace` | SRIA service marketplace — AlephNet-specific |
| `openclaw-gateway` | AlephNet-to-OpenClaw bridge — oboto already has `openclaw` plugin |
| `openclaw-skills` | OpenClaw skill management — oboto already has `openclaw` plugin |
| `prime-tuner` | Prime-Resonant frequency tuning — AlephNet-specific |
| `reputation-manager` | Web of Trust / reputation — AlephNet-specific |
| `resonant-agent` | SRIA agent engine — AlephNet-specific |
| `secure-comms` | Encrypted P2P messaging — AlephNet-specific |
| `social-mirror` | Social graph ingestion — AlephNet-specific |
| `swarm-controller` | DSN node orchestration — AlephNet-specific |
| `wallet` | Aleph Token management — AlephNet-specific |
| `hello-world` | Already exists in oboto |

---

## Porting Considerations

All notaclaw plugins are **TypeScript** targeting an **Electron IPC** plugin system with `manifest.json`. Oboto uses **ESM JavaScript** with `plugin.json` and a [`createPluginAPI()`](src/plugins/plugin-api.mjs:30) interface exposing `tools`, `ws`, `events`, `surfaces`, `ai`, `storage`, `settings`, and `ui` APIs.

Key differences to address during port:
1. **TypeScript → ESM JS** — transpile or rewrite
2. **`manifest.json` → `plugin.json`** — different schema
3. **Electron IPC channels → WebSocket handlers** — replace `ipcMain.handle` with `api.ws.register()`
4. **Aleph store API → PluginStorage** — replace `store:read/write` with `api.storage`
5. **DSN tool registration → ToolExecutor** — replace `dsn:register-tool` with `api.tools.register()`
6. **Renderer components** — notaclaw uses React/TSX; oboto supports JSX components via surfaces

---

## Recommended Import Priority

```
Phase 1 — Core Capabilities
  1. code-interpreter      (code execution)
  2. document-reader       (file/document handling)
  3. knowledge-graph       (persistent memory)
  4. poorman-alpha         (upgrade math plugin)
  5. voice-suite           (upgrade TTS plugin)

Phase 2 — Creative & Visual
  6. canvas-viz            (inline visualizations)
  7. html-artifacts        (artifact preview/edit)
  8. prompt-editor         (prompt chain builder)

Phase 3 — Infrastructure  
  9. notification-center   (system notifications)
  10. semantic-search      (content retrieval)
  11. thought-stream-debugger (agent observability)
  12. logger               (log viewer)

Phase 4 — Extended
  13. planman              (AI project management)
  14. workflow-weaver      (visual workflow editor)
  15. note-taker           (note taking)
  16. secure-backup        (data safety)
  17. temporal-voyager     (state replay debugging)
```
