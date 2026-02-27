# Oboto Website Update Plan

## Overview

The website at `/Users/sschepis/Development/oboto-1fdb6109` needs to be updated to reflect the current state of the Oboto app at `/Users/sschepis/Development/ai-man`. The app is now at **v1.1.1** with significant architectural changes (Eventic engine, agentic providers, expanded plugin system, project management, checkpoint system) that the website does not yet reflect.

---

## Gap Analysis: App vs Website

### Version Mismatch
- **App**: v1.1.1 (`package.json`)
- **Website**: References v1.0.0 in download links, hero section

### Architecture Changes Not Reflected
| App Reality | Website Shows |
|-------------|--------------|
| **Eventic Engine** (`eventic.mjs`, `eventic-facade.mjs`) — event-driven core | Generic "Agent Loop" description |
| **Agentic Provider Registry** (`src/core/agentic/`) — pluggable agent behaviors | No mention of provider architecture |
| **EventicFacade** as central orchestrator | References `MiniAIAssistant` |
| **Checkpoint System** (`checkpoint-store.mjs`, `task-checkpoint-manager.mjs`) | Not mentioned |
| **Project Management** suite (`src/project-management/`) — phase controller, task scheduler, template registry, surface generator | Not mentioned |
| **Prompt Router** (`prompt-router.mjs`) — intelligent model routing | Only basic model routing env vars |
| **Model Registry** (`model-registry.mjs`) — comprehensive model catalog | Not mentioned |
| **ResoLang Service** (`resolang-service.mjs`) | Not mentioned |

### Plugin Count Discrepancy
- **App**: 29 plugin directories in `plugins/`
- **Website**: Says "25+ built-in plugins", lists only 28 in README

### Tool Categories Mismatch
- **Website ToolCategories.tsx**: 14 categories
- **App actual**: 17 categories (adds Chrome Extension tools, Surfaces tools, Async Tasks separately from the listed ones)

### Missing Feature Documentation
The website `docs.ts` is missing documentation for:
1. **Eventic Architecture** — The event-driven engine powering the agent
2. **Project Management** — Phase controller, task scheduler, template registry
3. **Checkpoint & Recovery** — Task checkpointing and recovery system
4. **Image Manipulation** — AI-powered image generation/editing skill
5. **Prompt Router** — Intelligent model selection per task type
6. **Model Registry** — Available models across all providers

### Download Page Issues
- macOS requirement says "macOS 10.12+" in README but "macOS 12" on download page — inconsistent
- No actual download links (buttons don't link to GitHub releases)
- Version number not shown

---

## Detailed Update Plan

### 1. Version & Branding Updates

**Files to modify:**
- `src/components/HeroSection.tsx` — Update badge text, version references
- `src/pages/DownloadPage.tsx` — Update version to 1.1.1, fix download links to GitHub releases
- `src/components/Footer.tsx` — Add Pricing link to footer

**Changes:**
- Replace all `1.0.0` references with `1.1.1`
- Update hero badge: "Now available for Mac & PC" → "v1.1.1 — Now available for Mac & PC"
- Download page: Link buttons to actual GitHub release URLs
- Fix macOS requirement consistency (use "macOS 12+")

---

### 2. FeatureHighlights Component Update

**File:** `src/components/FeatureHighlights.tsx`

Update the 6 feature cards to reflect current capabilities:

| Current | Updated |
|---------|---------|
| Multi-Agent Architecture | Multi-Agent Architecture (no change needed) |
| Consciousness Processor | Consciousness Processor (no change needed) |
| Generative UI | Generative UI (no change needed) |
| 50+ Built-in Tools | **60+ Built-in Tools** — update count to reflect plugin-contributed tools |
| Chrome Extension | **29 Plugins** — highlight the plugin ecosystem |
| Library API | **Cloud Sync & Collaboration** — more compelling than library API for landing page |

Add new icons where appropriate (e.g., `Plug` for plugins, `Cloud` for cloud sync).

---

### 3. ToolCategories Component Update

**File:** `src/components/ToolCategories.tsx`

Add 3 missing tool categories:
1. **Chrome Extension** — `tabs, DOM, CDP, cookies` — "Full Chrome browser control via extension"
2. **Surfaces** — `create, update, delete` — "Dynamic React dashboard generation"  
3. **Async Tasks** — `spawn, status, cancel` — "Background task management"

Update heading: "50+" → "60+" tools

---

### 4. ArchitectureSection Update

**File:** `src/components/ArchitectureSection.tsx`

Update the architecture layers to reflect Eventic:

| Current Layer | Updated Layer |
|--------------|---------------|
| User Interface: Chat · Surfaces · Dashboard | User Interface: Chat · Surfaces · Dashboard · Command Palette |
| Agent Loop: Multi-Agent · Background Tasks · Schedules | **Eventic Engine**: Multi-Agent · Background Tasks · Schedules · Checkpoints |
| Consciousness Processor: Fact Engine · Somatic · Archetypes | Consciousness Processor: Fact Engine · Somatic · Archetypes (same) |
| Tool Execution: 50+ Tools · MCP · OpenClaw | Tool Execution: **60+** Tools · MCP · OpenClaw · **29 Plugins** |
| System Layer: File System · Browser · Desktop · Shell | System Layer: File System · Browser · Desktop · Shell · **Chrome Extension** |

---

### 5. VignetteSection Update

**File:** `src/components/VignetteSection.tsx`

Minor updates to vignette descriptions:
- Multi-Agent: Update to mention Eventic engine coordination
- Cloud Collab: Update flow steps to include "Eventic dispatches" instead of generic "Cloud orchestrates"

---

### 6. Documentation Content Update

**File:** `src/content/docs.ts`

#### New Doc Sections to Add:

**A. "Eventic Architecture" (Architecture category)**
- Event-driven engine design
- Plugin system integration
- Provider registry
- State management through events

**B. "Project Management" (Features category)**
- Phase controller for development workflows
- Task scheduler with templates
- Surface generator for project dashboards
- Template registry for project scaffolding

**C. "Checkpoint & Recovery" (Features category)**
- Task checkpointing for long-running operations
- State persistence and recovery
- Checkpoint store architecture

**D. "Image Manipulation" (Features category)**
- AI-powered image generation
- Image editing and analysis
- Integration with multiple image providers

#### Doc Sections to Update:

**E. "Overview" doc**
- Update layer descriptions to mention Eventic
- Update tool count to 60+
- Update plugin count to 29
- Add Project Management to key capabilities
- Add Checkpoint system mention

**F. "Multi-Agent Architecture" doc**
- Reference Eventic engine as the coordination layer
- Add checkpoint/recovery information for background tasks

**G. "Plugin System" doc**
- Update plugin list to show all 29 plugins
- Add the missing plugin: `workflow-weaver`
- Update plugin API surface to match current `plugin-api.mjs`

**H. "Tools Reference" doc**
- Add Chrome Extension tools section
- Update tool counts
- Add any new tools from recent development

**I. "Configuration Reference" doc**
- Update with any new env variables
- Add model registry information

---

### 7. CodeExample Component Update

**File:** `src/components/CodeExample.tsx`

Update the code example to use both the `AiMan` and `Oboto` export names (since `Oboto` is the alias), and add a surface creation example:

```javascript
import { Oboto } from '@sschepis/oboto';

const ai = new Oboto({ workingDir: process.cwd() });

// Execute a task
const result = await ai.execute(
  'Create a REST API for user management'
);

// Design then implement
const { design, result: impl } = await ai.designAndImplement(
  'Add authentication middleware'
);

// Stream responses
await ai.executeStream('Refactor the database layer', (chunk) => {
  process.stdout.write(chunk);
});

// Register custom tools
ai.registerTool(schema, handler);
```

---

### 8. Plugin Gallery (New Section or Page)

**New file:** `src/components/PluginGallery.tsx`

Add a new section to the landing page (or a dedicated page) showcasing all 29 plugins organized by category:

| Category | Plugins |
|----------|---------|
| **AI & Language** | code-interpreter, embed, semantic-search, thought-stream-debugger |
| **Browser & Web** | browser, chrome-ext, firecrawl, web-search |
| **Data & Visualization** | canvas-viz, html-artifacts, knowledge-graph |
| **Documents** | document-reader, note-taker |
| **Media** | image, tts, voice-suite |
| **Automation** | workflows, workflow-weaver |
| **System** | logger, notification-center, secure-backup, temporal-voyager |
| **AI Personas** | personas, prompt-editor, ui-themes |
| **Integration** | openclaw |
| **Development** | hello-world, math, poorman-alpha |

This could be added as a section between ToolCategories and CodeExample on the landing page.

---

### 9. DownloadPage Improvements

**File:** `src/pages/DownloadPage.tsx`

- Add version number display: "v1.1.1"
- Link macOS button to: `https://github.com/sschepis/oboto/releases/latest/download/Oboto-1.1.1-arm64.dmg`
- Link Windows button to: `https://github.com/sschepis/oboto/releases/latest`
- Add npm install option prominently
- Add changelog/release notes link

---

### 10. Footer Update

**File:** `src/components/Footer.tsx`

Add missing links:
- Product section: Add "Pricing" link
- Developers section: Point "API Reference" to `/docs?section=library-api`
- Developers section: Point "Chrome Extension" to `/docs?section=chrome-extension`
- Add "Changelog" link pointing to GitHub releases

---

### 11. PricingPage Review

**File:** `src/pages/PricingPage.tsx`

Update feature matrix:
- Update "Cloud agents" description to mention Eventic-powered agents
- Update "Tool integrations" counts if needed
- Add "Checkpoint & Recovery" as a feature row

---

## Implementation Order

The recommended implementation order prioritizes user-facing accuracy:

1. **Version updates** (quick wins, critical accuracy)
2. **Documentation content** (`docs.ts` — largest content update)
3. **FeatureHighlights + ToolCategories** (landing page accuracy)
4. **ArchitectureSection** (landing page accuracy)
5. **DownloadPage** (functional links)
6. **CodeExample** (minor update)
7. **Plugin Gallery** (new feature)
8. **Footer** (minor navigation fix)
9. **VignetteSection** (cosmetic)
10. **PricingPage** (minor updates)

---

## File Summary

| File | Action | Priority |
|------|--------|----------|
| `src/content/docs.ts` | Major update — add 4 new sections, update 5 existing | **High** |
| `src/components/FeatureHighlights.tsx` | Update feature cards | **High** |
| `src/components/ToolCategories.tsx` | Add 3 categories, update counts | **High** |
| `src/components/ArchitectureSection.tsx` | Update layer descriptions | **High** |
| `src/components/HeroSection.tsx` | Version update | **High** |
| `src/pages/DownloadPage.tsx` | Fix links, add version | **High** |
| `src/components/CodeExample.tsx` | Update code sample | **Medium** |
| `src/components/VignetteSection.tsx` | Minor description updates | **Medium** |
| `src/components/Footer.tsx` | Add missing links | **Medium** |
| `src/pages/PricingPage.tsx` | Feature matrix updates | **Medium** |
| `src/components/PluginGallery.tsx` | **New file** — plugin showcase | **Low** |
| `src/pages/Index.tsx` | Add PluginGallery to page | **Low** |
