# Plugin Extraction Proposals

Subsystems identified as candidates for extraction from core into standalone plugins.
Ordered by extraction difficulty (easiest first) and independence from core.

---

## Tier 1 — Low Coupling, Easy Extraction

These subsystems have minimal dependencies on core internals. They interact only via
well-defined boundaries (tool registration, event bus, WS handlers) that map directly
onto the existing Plugin API (`api.tools`, `api.events`, `api.ws`).

### 1. `firecrawl` — Web Scraping & Crawling
| | |
|---|---|
| **Source files** | `src/execution/handlers/firecrawl-handlers.mjs`, `src/tools/definitions/firecrawl-tools.mjs` |
| **Dependencies** | `consoleStyler` (logging only), `fetch`, `FIRECRAWL_API_KEY` env var |
| **Plugin API surface** | `api.tools.register()` × 3 tools, `api.settings` for API key |
| **Extraction effort** | ~1 hour |
| **Rationale** | Zero coupling to core state. Self-contained HTTP client wrapping an external API. Users who don't use Firecrawl shouldn't have it loaded. |

### 2. `math` — Wolfram-style Math & Computation
| | |
|---|---|
| **Source files** | `src/execution/handlers/math-handlers.mjs`, `src/tools/definitions/math-tools.mjs` |
| **Dependencies** | `mathjs` npm package, `consoleStyler` |
| **Plugin API surface** | `api.tools.register()` × ~3 tools |
| **Extraction effort** | ~1 hour |
| **Rationale** | The `mathjs` dependency is large (~2MB). Many users don't need symbolic math. Clean function-in, string-out interface. |

### 3. `embed` — Rich Media Embedding
| | |
|---|---|
| **Source files** | `src/execution/handlers/embed-handlers.mjs`, `src/tools/definitions/embed-tools.mjs` |
| **Dependencies** | `eventBus` (single event: `embed:created`) |
| **Plugin API surface** | `api.tools.register()` × 1 tool, `api.events.emit()` |
| **Extraction effort** | ~30 min |
| **Rationale** | Single tool, single event. Completely self-contained. |

### 4. `web-search` — Web Search & Content Fetch
| | |
|---|---|
| **Source files** | `src/execution/handlers/web-handlers.mjs`, `src/tools/definitions/web-tools.mjs` |
| **Dependencies** | `consoleStyler`, `fetch` |
| **Plugin API surface** | `api.tools.register()` × ~3 tools |
| **Extraction effort** | ~1 hour |
| **Rationale** | Pure HTTP-based web search. No core state dependencies. |

### 5. `image-generation` — AI Image Generation & Processing
| | |
|---|---|
| **Source files** | `src/execution/handlers/image-handlers.mjs`, `src/tools/definitions/image-tools.mjs` |
| **Dependencies** | `sharp` npm package, `fs`, `config.mjs` (for API keys), `workspaceContentServer` |
| **Plugin API surface** | `api.tools.register()` × ~5 tools, `api.settings` for provider config |
| **Extraction effort** | ~2 hours |
| **Rationale** | `sharp` is a heavy native addon. Users who don't need image gen shouldn't pay the install cost. Needs settings for API keys (OpenAI, Stability, etc). |

### 6. `tts` — Text-to-Speech
| | |
|---|---|
| **Source files** | `src/tools/definitions/tts-tools.mjs` (definition only — handlers inline or minimal) |
| **Dependencies** | External TTS API |
| **Plugin API surface** | `api.tools.register()` × ~2 tools |
| **Extraction effort** | ~1 hour |
| **Rationale** | Optional capability. Self-contained API wrapper. |

---

## Tier 2 — Moderate Coupling, Worthwhile Extraction

These subsystems have some coupling to core (they read/write core state or need
multiple system services) but the boundaries are well-defined.

### 7. `browser-automation` — Puppeteer Browser Control
| | |
|---|---|
| **Source files** | `src/execution/handlers/browser-handlers.mjs`, `src/tools/definitions/browser-tools.mjs` |
| **Dependencies** | `puppeteer` npm package, `consoleStyler` |
| **Plugin API surface** | `api.tools.register()` × ~6 tools |
| **Extraction effort** | ~2 hours |
| **Rationale** | `puppeteer` is very heavy (~300MB Chromium download). Browser automation is a power-user feature. Clean handler class with no core coupling. |

### 8. `chrome-extension` — Chrome Extension Bridge
| | |
|---|---|
| **Source files** | `src/execution/handlers/chrome-ext-handlers.mjs`, `src/tools/definitions/chrome-ext-tools.mjs`, `src/server/chrome-ws-bridge.mjs`, `chrome-extension/` directory |
| **Dependencies** | `ChromeWsBridge`, dedicated WS endpoint (`/ws/chrome`) |
| **Plugin API surface** | `api.tools.register()` × ~15 tools, `api.ws.register()` for bridge |
| **Extraction effort** | ~4 hours |
| **Rationale** | Entirely optional subsystem. Has its own WS endpoint. Most users don't use the Chrome extension. Extraction removes ~25KB of tool definitions from core. |

### 9. `openclaw` — OpenClaw Legal Document Integration
| | |
|---|---|
| **Source files** | `src/integration/openclaw/client.mjs`, `src/integration/openclaw/manager.mjs`, `src/execution/handlers/openclaw-handlers.mjs`, `src/tools/definitions/openclaw-tools.mjs`, `src/server/ws-handlers/openclaw-handler.mjs` |
| **Dependencies** | `crypto`, external API, WS handler for UI |
| **Plugin API surface** | `api.tools.register()`, `api.ws.register()` |
| **Extraction effort** | ~3 hours |
| **Rationale** | Domain-specific integration (legal docs). Most users don't need it. Has its own WS handler, making it a complete vertical slice. |

### 10. `workflows` — Visual Workflow Engine (BubbleLab)
| | |
|---|---|
| **Source files** | `src/execution/handlers/workflow-handlers.mjs`, `src/execution/handlers/workflow-surface-handlers.mjs`, `src/tools/definitions/workflow-tools.mjs`, `src/tools/definitions/workflow-surface-tools.mjs`, `src/services/workflow-service.mjs`, `src/server/ws-handlers/workflow-handler.mjs` |
| **Dependencies** | `surfaceManager`, `eventBus`, `fs`, `child_process` |
| **Plugin API surface** | `api.tools.register()`, `api.ws.register()`, `api.surfaces`, `api.events` |
| **Extraction effort** | ~4 hours |
| **Rationale** | Complete subsystem with its own service layer, tools, and WS handlers. Users who don't use visual workflows shouldn't carry the weight. |

### 11. `personas` — AI Persona Management
| | |
|---|---|
| **Source files** | `src/core/persona-manager.mjs`, `src/execution/handlers/persona-handlers.mjs`, `src/tools/definitions/persona-tools.mjs` |
| **Dependencies** | `PersonaManager`, `assistant` reference for switching |
| **Plugin API surface** | `api.tools.register()`, `api.events`, `api.storage` for persona data |
| **Extraction effort** | ~3 hours |
| **Rationale** | Self-contained personality/prompt management. Not everyone uses personas. Clean manager → handler → tools pattern. |

### 12. `ui-theming` — Dynamic UI Styling & Themes
| | |
|---|---|
| **Source files** | `src/execution/handlers/ui-style-handlers.mjs`, `src/tools/definitions/ui-style-tools.mjs`, `src/server/ws-handlers/style-handler.mjs` |
| **Dependencies** | `eventBus`, `fs`, workspace root |
| **Plugin API surface** | `api.tools.register()`, `api.ws.register()`, `api.events` |
| **Extraction effort** | ~3 hours |
| **Rationale** | Large file (24KB handler). Theme management is optional. Has presets and token system that are self-contained. |

### 13. `cloud-sync` — Cloud Sync & Collaboration
| | |
|---|---|
| **Source files** | `src/cloud/` (9 files, ~70KB total), `src/server/ws-handlers/cloud-handler.mjs` |
| **Dependencies** | `eventBus`, `secretsManager`, auth tokens, external cloud API |
| **Plugin API surface** | `api.ws.register()` × many, `api.events`, `api.settings` |
| **Extraction effort** | ~6 hours |
| **Rationale** | Large, self-contained subsystem with its own auth, sync, and realtime layers. Many users run purely local. Currently ~70KB of code that can be fully optional. |

---

## Tier 3 — Higher Coupling, Strategic Extraction

These require more refactoring because they touch core abstractions (AI provider, history, surfaces).
They're still worth extracting long-term for modularity.

### 14. `structured-dev` — Structured Development Flow
| | |
|---|---|
| **Source files** | `src/structured-dev/` (12 files, ~100KB total), `src/execution/handlers/structured-dev-handlers.mjs`, `src/tools/definitions/structured-dev-tools.mjs` |
| **Dependencies** | `ManifestManager`, `FlowManager`, `aiAssistantClass`, workspace FS |
| **Plugin API surface** | `api.tools.register()` × ~10 tools, `api.ai.ask()`, `api.storage` |
| **Extraction effort** | ~8 hours |
| **Rationale** | Large subsystem (C4 visualizer, CI/CD architect, API doc smith, etc.) that most casual users never touch. However, it uses `aiAssistantClass` for spawning sub-tasks, which needs interface adaptation. |

### 15. `project-management` — Project Bootstrapping & Templates
| | |
|---|---|
| **Source files** | `src/project-management/` (7 files, ~117KB total) |
| **Dependencies** | `surfaceManager`, `eventBus`, template registry, AI provider |
| **Plugin API surface** | `api.tools.register()`, `api.surfaces`, `api.ai`, `api.events` |
| **Extraction effort** | ~6 hours |
| **Rationale** | Complete project management subsystem with phase controller, task scheduler, template registry. Only relevant during project creation/bootstrapping. |

### 16. `reasoning` — Fact Inference & Semantic Collapse
| | |
|---|---|
| **Source files** | `src/reasoning/fact-inference-engine.mjs`, `src/reasoning/semantic-collapse.mjs` |
| **Dependencies** | AI provider, conversation history |
| **Plugin API surface** | `api.ai.ask()`, `api.events`, middleware hooks |
| **Extraction effort** | ~4 hours |
| **Rationale** | Experimental reasoning capabilities. Uses middleware hooks (`api.middleware.use()`) to intercept AI requests. Good candidate for `before:ai-request` middleware plugin pattern. |

### 17. `consciousness` — Somatic Engine & Consciousness Processing
| | |
|---|---|
| **Source files** | `src/core/consciousness-processor.mjs`, `src/core/somatic-engine.mjs`, `src/core/somatic-narrative.mjs` |
| **Dependencies** | Deep coupling to AI provider, prompt system, history |
| **Plugin API surface** | `api.middleware.use()`, `api.ai`, `api.events` |
| **Extraction effort** | ~8 hours |
| **Rationale** | Experimental subsystem. Not needed for basic AI assistant usage. Would use middleware hooks to inject consciousness processing into the AI pipeline. Requires significant refactoring of prompt construction. |

---

## Extraction Priority Matrix

```
                    Low Coupling ◄──────────────► High Coupling
                    │                                        │
 High     ┌────────┼────────────────────────────────────────┐
 Value    │  firecrawl   browser   cloud-sync               │
          │  math        chrome    structured-dev            │
          │  image-gen   openclaw  project-mgmt              │
          │              workflows                           │
          │                                                  │
 Low      │  embed       personas  reasoning                 │
 Value    │  tts         ui-theme  consciousness             │
          │  web-search                                      │
          └──────────────────────────────────────────────────┘
```

## Recommended Extraction Order

1. **`firecrawl`** — Quickest win, zero coupling, demonstrates the pattern
2. **`math`** — Removes heavy `mathjs` dependency from core
3. **`embed`** — Trivial extraction, good for testing plugin lifecycle
4. **`web-search`** — Simple HTTP tools
5. **`image-generation`** — Removes `sharp` native addon from core
6. **`browser-automation`** — Removes massive `puppeteer` dependency
7. **`tts`** — Simple optional feature
8. **`chrome-extension`** — Complete vertical slice with own WS bridge
9. **`openclaw`** — Domain-specific, complete vertical slice
10. **`personas`** — Self-contained personality system
11. **`workflows`** — Complete subsystem extraction
12. **`ui-theming`** — Large but well-bounded
13. **`cloud-sync`** — Large subsystem, many users run local-only
14. **`structured-dev`** — Huge codebase reduction, but needs AI interface work
15. **`project-management`** — Same pattern as structured-dev
16. **`reasoning`** — Experimental, middleware-based
17. **`consciousness`** — Most coupled, but most optional

## Core Size Reduction Estimate

| Extraction tier | Files removed | Code removed (approx) |
|-----------------|---------------|----------------------|
| Tier 1 (1-6)    | ~12 files     | ~45KB                |
| Tier 2 (7-13)   | ~25 files     | ~160KB               |
| Tier 3 (14-17)  | ~25 files     | ~250KB               |
| **Total**        | **~62 files** | **~455KB**           |

Extracting all Tier 1 and Tier 2 plugins would reduce the core by ~37 files and ~205KB,
making the core focused on: chat, conversations, file operations, shell, surfaces, agent loop, and the AI provider — the essential foundation.
